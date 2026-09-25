import { and, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { importRecipeSchema, recipeSchema, updateRecipeSchema } from '@pantry/shared'
import { requireAdult, requireMember } from '../context.js'
import { recipeIngredients, recipes } from '../db/schema.js'
import { conflict, notFound } from '../errors.js'
import { importRecipeFromUrl } from '../services/recipe-import.js'
import { loadRecipe, loadRecipes, recipeAvailability } from '../services/recipes.js'

export async function registerRecipeRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx

  app.get('/recipes', async (request) => {
    const member = requireMember(request)
    return { recipes: await loadRecipes(db, member.householdId) }
  })

  app.get('/recipes/:id', async (request) => {
    const member = requireMember(request)
    const { id } = request.params as { id: string }
    return loadRecipe(db, member.householdId, id)
  })

  /** "What could we make right now?" — the meal planner's opening question. */
  app.get('/recipes/availability', async (request) => {
    const member = requireMember(request)
    const all = await loadRecipes(db, member.householdId)
    const availability = await Promise.all(
      all.map((recipe) => recipeAvailability(db, member.householdId, recipe)),
    )
    return { availability }
  })

  app.get('/recipes/:id/availability', async (request) => {
    const member = requireMember(request)
    const { id } = request.params as { id: string }
    const { servings } = request.query as { servings?: string }

    const recipe = await loadRecipe(db, member.householdId, id)
    const parsed = servings === undefined ? undefined : Number.parseInt(servings, 10)
    return recipeAvailability(
      db,
      member.householdId,
      recipe,
      Number.isFinite(parsed) ? parsed : undefined,
    )
  })

  /**
   * Read a recipe off a web page. Returns a draft and saves nothing — the same
   * rule as a photo scan: a machine proposes, a person decides (D-006).
   */
  app.post(
    '/recipes/import',
    // This is the one endpoint that makes the server fetch a URL someone typed.
    { config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } },
    async (request) => {
      requireAdult(request)
      const { url } = importRecipeSchema.parse(request.body)
      return importRecipeFromUrl(url, { userAgent: app.ctx.env.OFF_USER_AGENT })
    },
  )

  app.post('/recipes', async (request, reply) => {
    const adult = requireAdult(request)
    const input = recipeSchema.parse(request.body)

    const recipe = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(recipes)
        .values({
          householdId: adult.householdId,
          name: input.name,
          servings: input.servings,
          instructions: input.instructions ?? null,
          sourceUrl: input.sourceUrl ?? null,
          tags: input.tags,
          createdById: adult.id,
        })
        .returning()
      if (!created) throw conflict('Could not save that recipe')

      if (input.ingredients.length > 0) {
        await tx.insert(recipeIngredients).values(
          input.ingredients.map((ingredient, index) => ({
            recipeId: created.id,
            productId: ingredient.productId ?? null,
            name: ingredient.name,
            quantity: ingredient.quantity,
            unit: ingredient.unit,
            optional: ingredient.optional,
            sortOrder: index,
          })),
        )
      }

      return created
    })

    return reply.status(201).send(await loadRecipe(db, adult.householdId, recipe.id))
  })

  app.patch('/recipes/:id', async (request) => {
    const adult = requireAdult(request)
    const { id } = request.params as { id: string }
    const input = updateRecipeSchema.parse(request.body)

    const [existing] = await db
      .select({ id: recipes.id })
      .from(recipes)
      .where(and(eq(recipes.id, id), eq(recipes.householdId, adult.householdId)))
      .limit(1)
    if (!existing) throw notFound('Recipe')

    await db.transaction(async (tx) => {
      await tx
        .update(recipes)
        .set({
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.servings === undefined ? {} : { servings: input.servings }),
          ...(input.instructions === undefined ? {} : { instructions: input.instructions ?? null }),
          ...(input.sourceUrl === undefined ? {} : { sourceUrl: input.sourceUrl ?? null }),
          ...(input.tags === undefined ? {} : { tags: input.tags }),
        })
        .where(eq(recipes.id, id))

      // Ingredients are replaced wholesale: they are a list, not a set of
      // independently addressable rows, and diffing them buys nothing.
      if (input.ingredients !== undefined) {
        await tx.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, id))
        if (input.ingredients.length > 0) {
          await tx.insert(recipeIngredients).values(
            input.ingredients.map((ingredient, index) => ({
              recipeId: id,
              productId: ingredient.productId ?? null,
              name: ingredient.name,
              quantity: ingredient.quantity,
              unit: ingredient.unit,
              optional: ingredient.optional,
              sortOrder: index,
            })),
          )
        }
      }
    })

    return loadRecipe(db, adult.householdId, id)
  })

  app.delete('/recipes/:id', async (request, reply) => {
    const adult = requireAdult(request)
    const { id } = request.params as { id: string }

    const deleted = await db
      .delete(recipes)
      .where(and(eq(recipes.id, id), eq(recipes.householdId, adult.householdId)))
      .returning({ id: recipes.id })
    if (deleted.length === 0) throw notFound('Recipe')

    return reply.status(204).send()
  })
}
