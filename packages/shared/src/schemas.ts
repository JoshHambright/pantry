/**
 * Request payload schemas. The API validates with these and the web app reuses
 * the inferred types, so the contract cannot drift between the two.
 */

import { z } from 'zod'
import {
  CATEGORIES,
  MEAL_SLOTS,
  MEMBER_ROLES,
  REQUEST_KINDS,
  REQUEST_STATUSES,
  SHOPPING_STATUSES,
  STORAGE_KINDS,
} from './domain.js'
import { UNIT_CODES } from './units.js'

export const unitSchema = z.enum(UNIT_CODES)
export const categorySchema = z.enum(CATEGORIES)
export const roleSchema = z.enum(MEMBER_ROLES)
export const storageKindSchema = z.enum(STORAGE_KINDS)
export const mealSlotSchema = z.enum(MEAL_SLOTS)
export const requestKindSchema = z.enum(REQUEST_KINDS)
export const requestStatusSchema = z.enum(REQUEST_STATUSES)
export const shoppingStatusSchema = z.enum(SHOPPING_STATUSES)

/** A plain calendar date, YYYY-MM-DD, that is also a real day. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }, 'not a real date')

export const idSchema = z.uuid()
export const quantitySchema = z.number().finite().nonnegative().max(1_000_000)
export const positiveQuantitySchema = z.number().finite().positive().max(1_000_000)

/** Four to eight digits. Long enough for a household, short enough for a phone. */
export const pinSchema = z.string().regex(/^\d{4,8}$/, 'PIN must be 4–8 digits')

export const loginSchema = z.object({
  memberId: idSchema,
  pin: pinSchema,
})

export const bootstrapSchema = z.object({
  householdName: z.string().trim().min(1).max(80),
  memberName: z.string().trim().min(1).max(60),
  pin: pinSchema,
})

export const createMemberSchema = z.object({
  name: z.string().trim().min(1).max(60),
  role: roleSchema,
  pin: pinSchema,
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
})

export const updateMemberSchema = createMemberSchema.partial().extend({
  pin: pinSchema.optional(),
})

export const locationSchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: storageKindSchema,
  sortOrder: z.number().int().min(0).max(999).optional(),
})

export const productSchema = z.object({
  name: z.string().trim().min(1).max(160),
  brand: z.string().trim().max(120).nullish(),
  upc: z
    .string()
    .trim()
    .regex(/^\d{6,14}$/, 'a barcode is 6–14 digits')
    .nullish(),
  category: categorySchema.default('other'),
  defaultUnit: unitSchema.default('each'),
  imageUrl: z.url().max(500).nullish(),
  /** Keep at least this much on hand; below it, the item suggests itself. */
  parQuantity: quantitySchema.nullish(),
  parUnit: unitSchema.nullish(),
  notes: z.string().trim().max(500).nullish(),
})

export const updateProductSchema = productSchema.partial()

/** Add stock, either for a known product or by creating one inline from a scan. */
export const addStockSchema = z
  .object({
    productId: idSchema.optional(),
    product: productSchema.optional(),
    locationId: idSchema,
    quantity: positiveQuantitySchema,
    unit: unitSchema,
    expiresAt: isoDateSchema.nullish(),
    purchasedAt: isoDateSchema.nullish(),
    note: z.string().trim().max(300).nullish(),
  })
  .refine(
    (value) => (value.productId === undefined) !== (value.product === undefined),
    'provide exactly one of productId or product',
  )

export const updateLotSchema = z.object({
  quantity: quantitySchema.optional(),
  unit: unitSchema.optional(),
  locationId: idSchema.optional(),
  expiresAt: isoDateSchema.nullish(),
  note: z.string().trim().max(300).nullish(),
})

export const consumeSchema = z.object({
  productId: idSchema,
  quantity: positiveQuantitySchema,
  unit: unitSchema,
  note: z.string().trim().max(300).nullish(),
})

export const shoppingItemSchema = z.object({
  productId: idSchema.nullish(),
  /** Free text for anything not yet a product — "birthday candles". */
  text: z.string().trim().min(1).max(160),
  quantity: positiveQuantitySchema.default(1),
  unit: unitSchema.default('each'),
  note: z.string().trim().max(300).nullish(),
})

export const updateShoppingItemSchema = shoppingItemSchema.partial().extend({
  status: shoppingStatusSchema.optional(),
})

/** Turn bought items into stock in one go, at the end of a shopping trip. */
export const checkoutSchema = z.object({
  locationId: idSchema,
  itemIds: z.array(idSchema).min(1).max(200),
  purchasedAt: isoDateSchema.optional(),
})

export const requestSchema = z.object({
  kind: requestKindSchema,
  text: z.string().trim().min(1).max(300),
  note: z.string().trim().max(500).nullish(),
})

export const respondToRequestSchema = z.object({
  status: requestStatusSchema,
  response: z.string().trim().max(500).nullish(),
})

export const recipeIngredientSchema = z.object({
  productId: idSchema.nullish(),
  name: z.string().trim().min(1).max(160),
  quantity: positiveQuantitySchema,
  unit: unitSchema,
  optional: z.boolean().default(false),
})

export const recipeSchema = z.object({
  name: z.string().trim().min(1).max(160),
  servings: z.number().int().min(1).max(50).default(4),
  instructions: z.string().trim().max(20_000).nullish(),
  sourceUrl: z.url().max(500).nullish(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  ingredients: z.array(recipeIngredientSchema).max(100).default([]),
})

export const updateRecipeSchema = recipeSchema.partial()

export const mealPlanEntrySchema = z
  .object({
    date: isoDateSchema,
    slot: mealSlotSchema,
    recipeId: idSchema.nullish(),
    customText: z.string().trim().max(160).nullish(),
    note: z.string().trim().max(500).nullish(),
    servings: z.number().int().min(1).max(50).nullish(),
  })
  .refine(
    (value) => Boolean(value.recipeId) || Boolean(value.customText),
    'a meal needs either a recipe or some text',
  )

export const cookSchema = z.object({
  /** Defaults to the recipe's own serving count. */
  servings: z.number().int().min(1).max(50).optional(),
  /** Add anything we were short of to the shopping list. */
  addShortfallToList: z.boolean().default(true),
})

/** One item a human confirmed from a camera scan, ready to become stock. */
export const scanCandidateConfirmSchema = z.object({
  candidateId: idSchema,
  accepted: z.boolean(),
  name: z.string().trim().min(1).max(160).optional(),
  quantity: positiveQuantitySchema.optional(),
  unit: unitSchema.optional(),
  category: categorySchema.optional(),
  productId: idSchema.nullish(),
  expiresAt: isoDateSchema.nullish(),
})

export const applyScanSchema = z.object({
  locationId: idSchema,
  candidates: z.array(scanCandidateConfirmSchema).min(1).max(100),
})

export const barcodeLookupSchema = z.object({
  upc: z.string().trim().regex(/^\d{6,14}$/),
})

export type LoginInput = z.infer<typeof loginSchema>
export type BootstrapInput = z.infer<typeof bootstrapSchema>
export type CreateMemberInput = z.infer<typeof createMemberSchema>
export type LocationInput = z.infer<typeof locationSchema>
export type ProductInput = z.infer<typeof productSchema>
export type AddStockInput = z.infer<typeof addStockSchema>
export type UpdateLotInput = z.infer<typeof updateLotSchema>
export type ConsumeInput = z.infer<typeof consumeSchema>
export type ShoppingItemInput = z.infer<typeof shoppingItemSchema>
export type CheckoutInput = z.infer<typeof checkoutSchema>
export type RequestInput = z.infer<typeof requestSchema>
export type RecipeInput = z.infer<typeof recipeSchema>
export type RecipeIngredientInput = z.infer<typeof recipeIngredientSchema>
export type MealPlanEntryInput = z.infer<typeof mealPlanEntrySchema>
export type CookInput = z.infer<typeof cookSchema>
export type ApplyScanInput = z.infer<typeof applyScanSchema>
export type ScanCandidateConfirm = z.infer<typeof scanCandidateConfirmSchema>
