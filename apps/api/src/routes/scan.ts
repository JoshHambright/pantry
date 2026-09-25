import { and, desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import {
  applyScanSchema,
  CATEGORY_DEFAULT_STORAGE,
  type ScanBatch,
  type ScanCandidate,
} from '@pantry/shared'
import { requireAdult, requireMember } from '../context.js'
import { locations as locationsTable, products, scanBatches, scanCandidates } from '../db/schema.js'
import { badRequest, conflict, notFound, unavailable } from '../errors.js'
import { addStock } from '../services/stock.js'
import { VisionError, type VisionImage } from '../services/vision.js'

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

/**
 * Which location each category should land in, for this household.
 *
 * Computed per request rather than stored: locations get renamed and added, and
 * a suggestion that outlives the place it points at is worse than none.
 */
type LocationSuggestions = Readonly<Record<string, string | undefined>>

function suggestionsFor(
  locations: readonly (typeof locationsTable.$inferSelect)[],
): LocationSuggestions {
  const firstOfKind = new Map<string, string>()
  for (const location of locations) {
    if (!firstOfKind.has(location.kind)) firstOfKind.set(location.kind, location.id)
  }
  const fallback = locations[0]?.id

  const byCategory: Record<string, string | undefined> = {}
  for (const [category, kind] of Object.entries(CATEGORY_DEFAULT_STORAGE)) {
    byCategory[category] = firstOfKind.get(kind) ?? fallback
  }
  return byCategory
}

const toCandidate = (
  row: typeof scanCandidates.$inferSelect,
  suggestions: LocationSuggestions,
): ScanCandidate => ({
  id: row.id,
  name: row.name,
  brand: row.brand,
  upc: row.upc,
  category: row.category,
  quantity: row.quantity,
  unit: row.unit,
  confidence: row.confidence,
  productId: row.productId,
  suggestedLocationId: suggestions[row.category] ?? null,
  accepted: row.accepted,
})

const toBatch = (
  row: typeof scanBatches.$inferSelect,
  candidates: readonly (typeof scanCandidates.$inferSelect)[],
  suggestions: LocationSuggestions = {},
): ScanBatch => ({
  id: row.id,
  status: row.status,
  note: row.note,
  error: row.error,
  candidates: candidates.map((candidate) => toCandidate(candidate, suggestions)),
  createdAt: row.createdAt.toISOString(),
})

export async function registerScanRoutes(app: FastifyInstance): Promise<void> {
  const { db, vision } = app.ctx

  const householdLocations = (householdId: string) =>
    db.select().from(locationsTable).where(eq(locationsTable.householdId, householdId))

  /**
   * Photo scan. Images are read into memory, sent to Claude, and dropped —
   * nothing is written to disk. A picture of your kitchen counter is not
   * something a household server should keep by default (DECISIONS.md D-007).
   */
  app.post(
    '/scan',
    { config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      const adult = requireAdult(request)
      if (!vision.available) {
        throw unavailable('Photo scanning is off. Set ANTHROPIC_API_KEY on the server.')
      }
      if (!request.isMultipart()) throw badRequest('Send the photos as multipart/form-data')

      const images: VisionImage[] = []
      let hint: string | undefined

      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (!ACCEPTED_TYPES.has(part.mimetype)) {
            throw badRequest(`${part.mimetype} is not an image we can read`)
          }
          const buffer = await part.toBuffer()
          images.push({
            data: buffer.toString('base64'),
            mediaType: part.mimetype as VisionImage['mediaType'],
          })
        } else if (part.fieldname === 'hint' && typeof part.value === 'string') {
          hint = part.value
        }
      }

      if (images.length === 0) throw badRequest('Attach at least one photo')

      const [batch] = await db
        .insert(scanBatches)
        .values({
          householdId: adult.householdId,
          memberId: adult.id,
          status: 'pending',
          note: hint ?? null,
        })
        .returning()
      if (!batch) throw conflict('Could not start that scan')

      try {
        const items = await vision.identify(images, hint)

        if (items.length === 0) {
          await db.update(scanBatches).set({ status: 'ready' }).where(eq(scanBatches.id, batch.id))
          return reply.status(201).send(toBatch({ ...batch, status: 'ready' }, []))
        }

        // Link anything we already stock so a scan updates rather than duplicates.
        const known = await db
          .select({ id: products.id, name: products.name, upc: products.upc })
          .from(products)
          .where(eq(products.householdId, adult.householdId))

        const rows = await db
          .insert(scanCandidates)
          .values(
            items.map((item) => ({
              batchId: batch.id,
              name: item.name,
              brand: item.brand,
              upc: null,
              category: item.category,
              quantity: item.quantity,
              unit: item.unit,
              confidence: item.confidence,
              productId: matchProduct(known, item.name),
            })),
          )
          .returning()

        await db.update(scanBatches).set({ status: 'ready' }).where(eq(scanBatches.id, batch.id))
        const suggestions = suggestionsFor(await householdLocations(adult.householdId))
        return reply.status(201).send(toBatch({ ...batch, status: 'ready' }, rows, suggestions))
      } catch (error) {
        const message =
          error instanceof VisionError ? error.message : 'The scan failed unexpectedly'
        await db
          .update(scanBatches)
          .set({ status: 'failed', error: message })
          .where(eq(scanBatches.id, batch.id))

        if (error instanceof VisionError) {
          throw error.retryable ? unavailable(message) : badRequest(message)
        }
        throw error
      }
    },
  )

  app.get('/scan', async (request) => {
    const member = requireMember(request)
    const rows = await db
      .select()
      .from(scanBatches)
      .where(eq(scanBatches.householdId, member.householdId))
      .orderBy(desc(scanBatches.createdAt))
      .limit(20)
    return { batches: rows.map((row) => toBatch(row, [])) }
  })

  app.get('/scan/:id', async (request) => {
    const member = requireMember(request)
    const { id } = request.params as { id: string }

    const [batch] = await db
      .select()
      .from(scanBatches)
      .where(and(eq(scanBatches.id, id), eq(scanBatches.householdId, member.householdId)))
      .limit(1)
    if (!batch) throw notFound('Scan')

    const candidates = await db.select().from(scanCandidates).where(eq(scanCandidates.batchId, id))
    return toBatch(batch, candidates, suggestionsFor(await householdLocations(member.householdId)))
  })

  /** Confirmed candidates become real stock. Nothing is added without this step. */
  app.post('/scan/:id/apply', async (request) => {
    const adult = requireAdult(request)
    const { id } = request.params as { id: string }
    const input = applyScanSchema.parse(request.body)

    const [batch] = await db
      .select()
      .from(scanBatches)
      .where(and(eq(scanBatches.id, id), eq(scanBatches.householdId, adult.householdId)))
      .limit(1)
    if (!batch) throw notFound('Scan')
    if (batch.status === 'applied') throw conflict('That scan has already been added')

    // Every destination in the payload has to belong to this household, not
    // just the batch default — a per-item override is a location id from the
    // client like any other.
    const ownLocations = new Set((await householdLocations(adult.householdId)).map((row) => row.id))
    if (!ownLocations.has(input.locationId)) throw notFound('Location')
    for (const confirmation of input.candidates) {
      if (confirmation.locationId && !ownLocations.has(confirmation.locationId)) {
        throw notFound('Location')
      }
    }

    const stored = await db.select().from(scanCandidates).where(eq(scanCandidates.batchId, id))
    const byId = new Map(stored.map((row) => [row.id, row]))

    let added = 0
    for (const confirmation of input.candidates) {
      const candidate = byId.get(confirmation.candidateId)
      if (!candidate) continue
      if (!confirmation.accepted) continue

      const name = confirmation.name ?? candidate.name
      const quantity = confirmation.quantity ?? candidate.quantity
      const unit = confirmation.unit ?? candidate.unit
      const category = confirmation.category ?? candidate.category

      // An explicit choice on the confirmation screen wins over the auto-link;
      // an explicit null means "this is a new product, not that one".
      const chosen =
        confirmation.productId === undefined ? candidate.productId : confirmation.productId

      const productId =
        chosen ??
        (await createVisionProduct(db, {
          householdId: adult.householdId,
          name,
          brand: candidate.brand,
          category,
          unit,
        }))

      await addStock(db, {
        householdId: adult.householdId,
        memberId: adult.id,
        productId,
        locationId: confirmation.locationId ?? input.locationId,
        quantity,
        unit,
        expiresAt: confirmation.expiresAt ?? null,
        note: 'Added from a photo scan',
      })

      await db
        .update(scanCandidates)
        .set({ accepted: true, productId })
        .where(eq(scanCandidates.id, candidate.id))
      added += 1
    }

    await db.update(scanBatches).set({ status: 'applied' }).where(eq(scanBatches.id, id))
    return { added }
  })

  app.delete('/scan/:id', async (request, reply) => {
    const adult = requireAdult(request)
    const { id } = request.params as { id: string }

    const deleted = await db
      .delete(scanBatches)
      .where(and(eq(scanBatches.id, id), eq(scanBatches.householdId, adult.householdId)))
      .returning({ id: scanBatches.id })
    if (deleted.length === 0) throw notFound('Scan')

    return reply.status(204).send()
  })
}

/** Exact name match only — a fuzzy guess here silently merges unrelated items. */
function matchProduct(
  known: readonly { id: string; name: string; upc: string | null }[],
  name: string,
): string | null {
  const key = name.toLowerCase().trim()
  return known.find((row) => row.name.toLowerCase().trim() === key)?.id ?? null
}

/** A product invented from a photo, recorded as such so its origin is visible. */
async function createVisionProduct(
  db: FastifyInstance['ctx']['db'],
  args: {
    householdId: string
    name: string
    brand: string | null
    category: (typeof scanCandidates.$inferSelect)['category']
    unit: (typeof scanCandidates.$inferSelect)['unit']
  },
): Promise<string> {
  const [created] = await db
    .insert(products)
    .values({
      householdId: args.householdId,
      name: args.name,
      brand: args.brand,
      category: args.category,
      defaultUnit: args.unit,
      source: 'vision',
    })
    .returning({ id: products.id })
  if (!created) throw conflict(`Could not save ${args.name}`)
  return created.id
}
