import { and, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { checkoutSchema, shoppingItemSchema, updateShoppingItemSchema } from '@pantry/shared'
import { requireAdult, requireMember } from '../context.js'
import { shoppingItems } from '../db/schema.js'
import { conflict, notFound } from '../errors.js'
import {
  addIfAbsent,
  checkoutItems,
  loadShoppingList,
  refillFromParLevels,
  suggestProductsFor,
  toShoppingItem,
} from '../services/shopping.js'

export async function registerShoppingRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx

  app.get('/shopping', async (request) => {
    const member = requireMember(request)
    return { items: await loadShoppingList(db, member.householdId) }
  })

  /** Anyone can add to the list — that is the point of a family list. */
  app.post('/shopping', async (request, reply) => {
    const member = requireMember(request)
    const input = shoppingItemSchema.parse(request.body)

    const created = await addIfAbsent(db, {
      householdId: member.householdId,
      productId: input.productId ?? null,
      text: input.text,
      quantity: input.quantity,
      unit: input.unit,
      requestedById: member.id,
      note: input.note ?? null,
    })
    if (!created) throw conflict('That is already on the list')

    return reply.status(201).send(created)
  })

  app.patch('/shopping/:id', async (request) => {
    const member = requireMember(request)
    const { id } = request.params as { id: string }
    const input = updateShoppingItemSchema.parse(request.body)

    const [updated] = await db
      .update(shoppingItems)
      .set({
        ...(input.text === undefined ? {} : { text: input.text }),
        ...(input.quantity === undefined ? {} : { quantity: input.quantity }),
        ...(input.unit === undefined ? {} : { unit: input.unit }),
        ...(input.note === undefined ? {} : { note: input.note ?? null }),
        ...(input.productId === undefined ? {} : { productId: input.productId ?? null }),
        ...(input.status === undefined
          ? {}
          : { status: input.status, boughtAt: input.status === 'bought' ? new Date() : null }),
      })
      .where(and(eq(shoppingItems.id, id), eq(shoppingItems.householdId, member.householdId)))
      .returning()
    if (!updated) throw notFound('List item')

    return toShoppingItem(updated)
  })

  app.delete('/shopping/:id', async (request, reply) => {
    const member = requireMember(request)
    const { id } = request.params as { id: string }

    const deleted = await db
      .delete(shoppingItems)
      .where(and(eq(shoppingItems.id, id), eq(shoppingItems.householdId, member.householdId)))
      .returning({ id: shoppingItems.id })
    if (deleted.length === 0) throw notFound('List item')

    return reply.status(204).send()
  })

  /** Sweep par levels and queue whatever has run low. */
  app.post('/shopping/refill', async (request) => {
    const adult = requireAdult(request)
    return refillFromParLevels(db, adult.householdId)
  })

  /** End of a shopping trip: bought lines become stock. */
  app.post('/shopping/checkout', async (request) => {
    const adult = requireAdult(request)
    const input = checkoutSchema.parse(request.body)

    return checkoutItems(db, {
      householdId: adult.householdId,
      memberId: adult.id,
      locationId: input.locationId,
      itemIds: input.itemIds,
      purchasedAt: input.purchasedAt,
    })
  })

  app.get('/shopping/suggest', async (request) => {
    const member = requireMember(request)
    const { text } = request.query as { text?: string }
    return { products: await suggestProductsFor(db, member.householdId, text ?? '') }
  })
}
