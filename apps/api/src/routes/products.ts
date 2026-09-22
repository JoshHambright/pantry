import { and, asc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import {
  barcodeLookupSchema,
  productSchema,
  updateProductSchema,
  type Product,
} from '@pantry/shared'
import { requireAdult, requireMember } from '../context.js'
import { products } from '../db/schema.js'
import { conflict, notFound } from '../errors.js'
import { toProduct } from '../services/stock.js'

export async function registerProductRoutes(app: FastifyInstance): Promise<void> {
  const { db, productLookup } = app.ctx

  app.get('/products', async (request) => {
    const member = requireMember(request)
    const { search } = request.query as { search?: string }

    const rows = await db
      .select()
      .from(products)
      .where(eq(products.householdId, member.householdId))
      .orderBy(asc(products.name))

    const key = search?.toLowerCase().trim()
    const filtered = key
      ? rows.filter(
          (row) =>
            row.name.toLowerCase().includes(key) ||
            (row.brand?.toLowerCase().includes(key) ?? false) ||
            row.upc === key,
        )
      : rows

    return { products: filtered.map(toProduct) }
  })

  app.post('/products', async (request, reply) => {
    const adult = requireAdult(request)
    const input = productSchema.parse(request.body)

    const product = await upsertProduct(app, adult.householdId, input)
    return reply.status(201).send(product)
  })

  app.patch('/products/:id', async (request) => {
    const adult = requireAdult(request)
    const { id } = request.params as { id: string }
    const input = updateProductSchema.parse(request.body)

    const [updated] = await db
      .update(products)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.brand === undefined ? {} : { brand: input.brand ?? null }),
        ...(input.upc === undefined ? {} : { upc: input.upc ?? null }),
        ...(input.category === undefined ? {} : { category: input.category }),
        ...(input.defaultUnit === undefined ? {} : { defaultUnit: input.defaultUnit }),
        ...(input.imageUrl === undefined ? {} : { imageUrl: input.imageUrl ?? null }),
        ...(input.parQuantity === undefined ? {} : { parQuantity: input.parQuantity ?? null }),
        ...(input.parUnit === undefined ? {} : { parUnit: input.parUnit ?? null }),
        ...(input.notes === undefined ? {} : { notes: input.notes ?? null }),
        updatedAt: new Date(),
      })
      .where(and(eq(products.id, id), eq(products.householdId, adult.householdId)))
      .returning()
    if (!updated) throw notFound('Product')

    return toProduct(updated)
  })

  app.delete('/products/:id', async (request, reply) => {
    const adult = requireAdult(request)
    const { id } = request.params as { id: string }

    // Lots cascade with the product — deleting is deliberate, not accidental.
    const deleted = await db
      .delete(products)
      .where(and(eq(products.id, id), eq(products.householdId, adult.householdId)))
      .returning({ id: products.id })
    if (deleted.length === 0) throw notFound('Product')

    return reply.status(204).send()
  })

  /**
   * Barcode resolution: what we already know first, then Open Food Facts. A
   * miss is a normal outcome, not an error — the UI falls through to a form.
   */
  app.get('/products/barcode/:upc', async (request) => {
    const member = requireMember(request)
    const { upc } = barcodeLookupSchema.parse(request.params)

    const [known] = await db
      .select()
      .from(products)
      .where(and(eq(products.householdId, member.householdId), eq(products.upc, upc)))
      .limit(1)
    if (known) return { source: 'known' as const, product: toProduct(known), suggestion: null }

    const found = await productLookup.byBarcode(upc)
    if (!found) return { source: 'miss' as const, product: null, suggestion: null }

    return {
      source: 'openfoodfacts' as const,
      product: null,
      suggestion: {
        name: found.name,
        brand: found.brand,
        upc: found.upc,
        category: found.category,
        imageUrl: found.imageUrl,
        quantity: found.quantity,
        unit: found.unit,
      },
    }
  })
}

/** Reuse the product a barcode already maps to instead of creating a duplicate. */
export async function upsertProduct(
  app: FastifyInstance,
  householdId: string,
  input: ReturnType<typeof productSchema.parse>,
  source: 'manual' | 'openfoodfacts' | 'vision' = 'manual',
): Promise<Product> {
  const { db } = app.ctx

  if (input.upc) {
    const [existing] = await db
      .select()
      .from(products)
      .where(and(eq(products.householdId, householdId), eq(products.upc, input.upc)))
      .limit(1)
    if (existing) return toProduct(existing)
  }

  const [created] = await db
    .insert(products)
    .values({
      householdId,
      name: input.name,
      brand: input.brand ?? null,
      upc: input.upc ?? null,
      category: input.category,
      defaultUnit: input.defaultUnit,
      imageUrl: input.imageUrl ?? null,
      parQuantity: input.parQuantity ?? null,
      parUnit: input.parUnit ?? null,
      notes: input.notes ?? null,
      source,
    })
    .returning()
  if (!created) throw conflict('Could not save that product')

  return toProduct(created)
}
