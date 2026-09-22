/**
 * Recipes, and the question the meal planner actually cares about: can we cook
 * this tonight with what is in the house?
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import {
  canConvert,
  convert,
  roundQuantity,
  summariseStock,
  type IngredientAvailability,
  type Recipe,
  type RecipeAvailability,
} from '@pantry/shared'
import type { Db } from '../db/client.js'
import { lots, products, recipeIngredients, recipes } from '../db/schema.js'
import { notFound } from '../errors.js'

type RecipeRow = typeof recipes.$inferSelect
type IngredientRow = typeof recipeIngredients.$inferSelect

function toRecipe(row: RecipeRow, ingredients: readonly IngredientRow[]): Recipe {
  return {
    id: row.id,
    name: row.name,
    servings: row.servings,
    instructions: row.instructions,
    sourceUrl: row.sourceUrl,
    tags: row.tags,
    ingredients: ingredients.map((ingredient) => ({
      id: ingredient.id,
      productId: ingredient.productId,
      name: ingredient.name,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      optional: ingredient.optional,
    })),
  }
}

export async function loadRecipes(db: Db, householdId: string): Promise<Recipe[]> {
  const recipeRows = await db
    .select()
    .from(recipes)
    .where(eq(recipes.householdId, householdId))
    .orderBy(asc(recipes.name))
  if (recipeRows.length === 0) return []

  const ingredientRows = await db
    .select()
    .from(recipeIngredients)
    .where(
      inArray(
        recipeIngredients.recipeId,
        recipeRows.map((row) => row.id),
      ),
    )
    .orderBy(asc(recipeIngredients.sortOrder))

  const byRecipe = new Map<string, IngredientRow[]>()
  for (const ingredient of ingredientRows) {
    const list = byRecipe.get(ingredient.recipeId)
    if (list) list.push(ingredient)
    else byRecipe.set(ingredient.recipeId, [ingredient])
  }

  return recipeRows.map((row) => toRecipe(row, byRecipe.get(row.id) ?? []))
}

export async function loadRecipe(db: Db, householdId: string, recipeId: string): Promise<Recipe> {
  const [row] = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .limit(1)
  if (!row) throw notFound('Recipe')

  const ingredients = await db
    .select()
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, recipeId))
    .orderBy(asc(recipeIngredients.sortOrder))

  return toRecipe(row, ingredients)
}

/**
 * Ingredients can name a product explicitly or just say "rice". Resolving the
 * loose ones by name is what lets someone paste a recipe in and still get a
 * useful "you're short two things" answer.
 */
async function resolveIngredientProducts(
  db: Db,
  householdId: string,
  recipe: Recipe,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>()
  const unresolved = recipe.ingredients.filter((ingredient) => !ingredient.productId)

  for (const ingredient of recipe.ingredients) {
    if (ingredient.productId) resolved.set(ingredient.id, ingredient.productId)
  }
  if (unresolved.length === 0) return resolved

  const candidates = await db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(eq(products.householdId, householdId))

  const byLowerName = new Map(candidates.map((row) => [row.name.toLowerCase().trim(), row.id]))

  for (const ingredient of unresolved) {
    const key = ingredient.name.toLowerCase().trim()
    const exact = byLowerName.get(key)
    if (exact) {
      resolved.set(ingredient.id, exact)
      continue
    }
    // Fall back to a containment match, longest product name first so
    // "brown rice" beats "rice" when both are stocked.
    const partial = candidates
      .filter((row) => {
        const name = row.name.toLowerCase().trim()
        return name.includes(key) || key.includes(name)
      })
      .sort((a, b) => b.name.length - a.name.length)[0]
    if (partial) resolved.set(ingredient.id, partial.id)
  }

  return resolved
}

export async function recipeAvailability(
  db: Db,
  householdId: string,
  recipe: Recipe,
  servings?: number,
): Promise<RecipeAvailability> {
  const targetServings = servings ?? recipe.servings
  const scale = recipe.servings > 0 ? targetServings / recipe.servings : 1
  const resolved = await resolveIngredientProducts(db, householdId, recipe)
  const productIds = [...new Set(resolved.values())]

  const stockRows = productIds.length
    ? await db
        .select({
          productId: lots.productId,
          quantity: lots.quantity,
          unit: lots.unit,
          id: lots.id,
          expiresAt: lots.expiresAt,
          purchasedAt: lots.purchasedAt,
        })
        .from(lots)
        .where(
          and(
            eq(lots.householdId, householdId),
            inArray(lots.productId, productIds),
            sql`${lots.quantity} > 0`,
          ),
        )
    : []

  const byProduct = new Map<string, typeof stockRows>()
  for (const row of stockRows) {
    const list = byProduct.get(row.productId)
    if (list) list.push(row)
    else byProduct.set(row.productId, [row])
  }

  const ingredients: IngredientAvailability[] = recipe.ingredients.map((ingredient) => {
    const needed = roundQuantity(ingredient.quantity * scale, 3)
    const productId = resolved.get(ingredient.id)
    const productLots = productId ? (byProduct.get(productId) ?? []) : []
    const totals = summariseStock(productLots)

    const onHand = totals.reduce(
      (sum, total) =>
        canConvert(total.unit, ingredient.unit)
          ? sum + convert(total.quantity, total.unit, ingredient.unit)
          : sum,
      0,
    )
    // Stock exists, but every lot of it is in a unit we refuse to guess at.
    const unknownUnit =
      totals.length > 0 && !totals.some((total) => canConvert(total.unit, ingredient.unit))

    return {
      ingredientId: ingredient.id,
      name: ingredient.name,
      needed,
      unit: ingredient.unit,
      onHand: roundQuantity(onHand, 3),
      shortfall: roundQuantity(Math.max(0, needed - onHand), 3),
      optional: ingredient.optional,
      unknownUnit,
    }
  })

  const blocking = ingredients.filter(
    (ingredient) => !ingredient.optional && ingredient.shortfall > 0,
  )

  return {
    recipeId: recipe.id,
    servings: targetServings,
    canCook: blocking.length === 0,
    missingCount: blocking.length,
    ingredients,
  }
}

/** The productId each ingredient resolves to, for the cook step to draw from. */
export async function resolvedIngredientProducts(
  db: Db,
  householdId: string,
  recipe: Recipe,
): Promise<Map<string, string>> {
  return resolveIngredientProducts(db, householdId, recipe)
}
