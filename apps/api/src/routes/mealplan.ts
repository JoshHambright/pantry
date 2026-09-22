import { and, asc, eq, gte, lte } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import {
  cookSchema,
  isoDateSchema,
  mealPlanEntrySchema,
  roundQuantity,
  type MealPlanEntry,
} from '@pantry/shared'
import { requireAdult, requireMember } from '../context.js'
import { mealPlanEntries, recipes } from '../db/schema.js'
import { badRequest, conflict, notFound } from '../errors.js'
import { loadRecipe, recipeAvailability, resolvedIngredientProducts } from '../services/recipes.js'
import { addIfAbsent } from '../services/shopping.js'
import { consumeStock, todayIso } from '../services/stock.js'

const toEntry = (
  row: typeof mealPlanEntries.$inferSelect,
  recipeName: string | null,
): MealPlanEntry => ({
  id: row.id,
  date: row.date,
  slot: row.slot,
  recipeId: row.recipeId,
  recipeName,
  customText: row.customText,
  note: row.note,
  servings: row.servings,
  cookedAt: row.cookedAt?.toISOString() ?? null,
  createdById: row.createdById,
})

export async function registerMealPlanRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx

  app.get('/mealplan', async (request) => {
    const member = requireMember(request)
    const { from, to } = request.query as { from?: string; to?: string }

    const start = from ? isoDateSchema.parse(from) : todayIso()
    // A fortnight is the useful default: this week and the next one.
    const end = to ? isoDateSchema.parse(to) : addDays(start, 13)

    const rows = await db
      .select({ entry: mealPlanEntries, recipeName: recipes.name })
      .from(mealPlanEntries)
      .leftJoin(recipes, eq(recipes.id, mealPlanEntries.recipeId))
      .where(
        and(
          eq(mealPlanEntries.householdId, member.householdId),
          gte(mealPlanEntries.date, start),
          lte(mealPlanEntries.date, end),
        ),
      )
      .orderBy(asc(mealPlanEntries.date))

    return { from: start, to: end, entries: rows.map((row) => toEntry(row.entry, row.recipeName)) }
  })

  app.post('/mealplan', async (request, reply) => {
    const adult = requireAdult(request)
    const input = mealPlanEntrySchema.parse(request.body)

    const [created] = await db
      .insert(mealPlanEntries)
      .values({
        householdId: adult.householdId,
        date: input.date,
        slot: input.slot,
        recipeId: input.recipeId ?? null,
        customText: input.customText ?? null,
        note: input.note ?? null,
        servings: input.servings ?? null,
        createdById: adult.id,
      })
      .returning()
    if (!created) throw conflict('Could not add that to the plan')

    const name = created.recipeId
      ? ((await loadRecipe(db, adult.householdId, created.recipeId)).name ?? null)
      : null
    return reply.status(201).send(toEntry(created, name))
  })

  app.patch('/mealplan/:id', async (request) => {
    const adult = requireAdult(request)
    const { id } = request.params as { id: string }
    const input = mealPlanEntrySchema.partial().parse(request.body)

    const [updated] = await db
      .update(mealPlanEntries)
      .set({
        ...(input.date === undefined ? {} : { date: input.date }),
        ...(input.slot === undefined ? {} : { slot: input.slot }),
        ...(input.recipeId === undefined ? {} : { recipeId: input.recipeId ?? null }),
        ...(input.customText === undefined ? {} : { customText: input.customText ?? null }),
        ...(input.note === undefined ? {} : { note: input.note ?? null }),
        ...(input.servings === undefined ? {} : { servings: input.servings ?? null }),
      })
      .where(
        and(eq(mealPlanEntries.id, id), eq(mealPlanEntries.householdId, adult.householdId)),
      )
      .returning()
    if (!updated) throw notFound('Meal')

    const name = updated.recipeId
      ? (await loadRecipe(db, adult.householdId, updated.recipeId)).name
      : null
    return toEntry(updated, name)
  })

  app.delete('/mealplan/:id', async (request, reply) => {
    const adult = requireAdult(request)
    const { id } = request.params as { id: string }

    const deleted = await db
      .delete(mealPlanEntries)
      .where(and(eq(mealPlanEntries.id, id), eq(mealPlanEntries.householdId, adult.householdId)))
      .returning({ id: mealPlanEntries.id })
    if (deleted.length === 0) throw notFound('Meal')

    return reply.status(204).send()
  })

  /**
   * Cooking is the moment the plan meets the pantry: draw down what the recipe
   * uses, and put whatever we were short of onto the shopping list.
   */
  app.post('/mealplan/:id/cook', async (request) => {
    const adult = requireAdult(request)
    const { id } = request.params as { id: string }
    const input = cookSchema.parse(request.body ?? {})

    const [entry] = await db
      .select()
      .from(mealPlanEntries)
      .where(and(eq(mealPlanEntries.id, id), eq(mealPlanEntries.householdId, adult.householdId)))
      .limit(1)
    if (!entry) throw notFound('Meal')
    if (!entry.recipeId) {
      throw badRequest('That meal is just a note, so there is nothing to take out of the pantry')
    }
    if (entry.cookedAt) throw conflict('That meal is already marked as cooked')

    const recipe = await loadRecipe(db, adult.householdId, entry.recipeId)
    const servings = input.servings ?? entry.servings ?? recipe.servings
    const availability = await recipeAvailability(db, adult.householdId, recipe, servings)
    const productByIngredient = await resolvedIngredientProducts(db, adult.householdId, recipe)

    const used: { name: string; quantity: number; unit: string }[] = []
    const short: { name: string; quantity: number; unit: string }[] = []

    for (const ingredient of availability.ingredients) {
      const productId = productByIngredient.get(ingredient.ingredientId)
      const takeable = roundQuantity(Math.min(ingredient.needed, ingredient.onHand), 4)

      if (productId && takeable > 0) {
        const result = await consumeStock(db, {
          householdId: adult.householdId,
          memberId: adult.id,
          productId,
          quantity: takeable,
          unit: ingredient.unit,
          note: `Cooked ${recipe.name}`,
        })
        used.push({ name: ingredient.name, quantity: result.consumed, unit: ingredient.unit })
      }

      if (ingredient.shortfall > 0) {
        short.push({
          name: ingredient.name,
          quantity: ingredient.shortfall,
          unit: ingredient.unit,
        })
        if (input.addShortfallToList && !ingredient.optional) {
          await addIfAbsent(db, {
            householdId: adult.householdId,
            productId: productId ?? null,
            text: ingredient.name,
            quantity: ingredient.shortfall,
            unit: ingredient.unit,
            autoReason: 'recipe',
            note: `Short for ${recipe.name}`,
          })
        }
      }
    }

    await db.update(mealPlanEntries).set({ cookedAt: new Date() }).where(eq(mealPlanEntries.id, id))

    return { recipe: recipe.name, servings, used, short }
  })
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}
