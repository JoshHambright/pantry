import { and, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { addStockSchema, consumeSchema, updateLotSchema } from '@pantry/shared'
import { requireAdult, requireMember } from '../context.js'
import { inventoryEvents, lots } from '../db/schema.js'
import { badRequest, notFound } from '../errors.js'
import {
  addStock,
  consumeStock,
  loadRecentEvents,
  loadStockRows,
  toLot,
  todayIso,
} from '../services/stock.js'
import { upsertProduct } from './products.js'

export async function registerInventoryRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx

  app.get('/inventory', async (request) => {
    const member = requireMember(request)
    const { includeEmpty, search } = request.query as { includeEmpty?: string; search?: string }

    const rows = await loadStockRows(db, member.householdId, {
      includeEmpty: includeEmpty === 'true',
      today: todayIso(),
    })

    const key = search?.toLowerCase().trim()
    const filtered = key
      ? rows.filter(
          (row) =>
            row.product.name.toLowerCase().includes(key) ||
            (row.product.brand?.toLowerCase().includes(key) ?? false),
        )
      : rows

    return { items: filtered }
  })

  app.post('/inventory', async (request, reply) => {
    const adult = requireAdult(request)
    const input = addStockSchema.parse(request.body)

    // Either an existing product or one created inline from a scan — the
    // schema guarantees exactly one of the two is present.
    const productId = input.productId
      ? input.productId
      : (await upsertProduct(app, adult.householdId, input.product!, 'manual')).id

    const lot = await addStock(db, {
      householdId: adult.householdId,
      memberId: adult.id,
      productId,
      locationId: input.locationId,
      quantity: input.quantity,
      unit: input.unit,
      expiresAt: input.expiresAt,
      purchasedAt: input.purchasedAt,
      note: input.note,
    })

    return reply.status(201).send(lot)
  })

  app.patch('/inventory/lots/:id', async (request) => {
    const adult = requireAdult(request)
    const { id } = request.params as { id: string }
    const input = updateLotSchema.parse(request.body)

    const [existing] = await db
      .select()
      .from(lots)
      .where(and(eq(lots.id, id), eq(lots.householdId, adult.householdId)))
      .limit(1)
    if (!existing) throw notFound('Item')

    if (input.unit !== undefined && input.quantity === undefined) {
      // Changing a lot's unit without restating the amount would silently
      // reinterpret the number already stored.
      throw badRequest('Give the new amount when you change the unit')
    }

    const [updated] = await db
      .update(lots)
      .set({
        ...(input.quantity === undefined ? {} : { quantity: input.quantity }),
        ...(input.unit === undefined ? {} : { unit: input.unit }),
        ...(input.locationId === undefined ? {} : { locationId: input.locationId }),
        ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt ?? null }),
        ...(input.note === undefined ? {} : { note: input.note ?? null }),
      })
      .where(eq(lots.id, id))
      .returning()
    if (!updated) throw notFound('Item')

    if (input.quantity !== undefined && input.quantity !== existing.quantity) {
      await db.insert(inventoryEvents).values({
        householdId: adult.householdId,
        productId: existing.productId,
        lotId: existing.id,
        kind: input.locationId && input.locationId !== existing.locationId ? 'moved' : 'adjusted',
        quantity: input.quantity - existing.quantity,
        unit: updated.unit,
        memberId: adult.id,
        note: input.note ?? null,
      })
    }

    // An adjustment to zero clears the lot out rather than leaving a husk.
    if (updated.quantity <= 0) {
      await db.delete(lots).where(eq(lots.id, id))
      return { ...toLot(updated), quantity: 0, removed: true }
    }

    return { ...toLot(updated), removed: false }
  })

  app.delete('/inventory/lots/:id', async (request, reply) => {
    const adult = requireAdult(request)
    const { id } = request.params as { id: string }
    const { discarded } = request.query as { discarded?: string }

    const [existing] = await db
      .select()
      .from(lots)
      .where(and(eq(lots.id, id), eq(lots.householdId, adult.householdId)))
      .limit(1)
    if (!existing) throw notFound('Item')

    await db.insert(inventoryEvents).values({
      householdId: adult.householdId,
      productId: existing.productId,
      lotId: existing.id,
      kind: discarded === 'true' ? 'discarded' : 'consumed',
      quantity: existing.quantity,
      unit: existing.unit,
      memberId: adult.id,
      note: null,
    })
    await db.delete(lots).where(eq(lots.id, id))

    return reply.status(204).send()
  })

  /** Use some of a product without caring which lot it comes out of. */
  app.post('/inventory/consume', async (request) => {
    const adult = requireAdult(request)
    const input = consumeSchema.parse(request.body)

    return consumeStock(db, {
      householdId: adult.householdId,
      memberId: adult.id,
      productId: input.productId,
      quantity: input.quantity,
      unit: input.unit,
      note: input.note,
    })
  })

  app.get('/inventory/events', async (request) => {
    const member = requireMember(request)
    const { limit } = request.query as { limit?: string }
    const parsed = Number.parseInt(limit ?? '50', 10)
    const capped = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 50
    return { events: await loadRecentEvents(db, member.householdId, capped) }
  })
}
