/**
 * Database schema.
 *
 * Everything is scoped to a household, even though this deployment will only
 * ever have one — it costs a column now and saves a migration if the app is
 * ever shared with another family.
 *
 * Quantities are double precision rather than numeric: a pantry has no money in
 * it, and `numeric` comes back from the driver as a string, which is a steady
 * source of arithmetic bugs for no benefit here.
 */

import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import {
  CATEGORIES,
  INVENTORY_EVENT_KINDS,
  MEAL_SLOTS,
  MEMBER_ROLES,
  PRODUCT_SOURCES,
  REQUEST_KINDS,
  REQUEST_STATUSES,
  SCAN_STATUSES,
  SHOPPING_STATUSES,
  STORAGE_KINDS,
  UNIT_CODES,
} from '@pantry/shared'

const id = () => uuid().primaryKey().defaultRandom()
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow()

export const households = pgTable('households', {
  id: id(),
  name: text().notNull(),
  createdAt: createdAt(),
})

export const members = pgTable(
  'members',
  {
    id: id(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    role: text({ enum: MEMBER_ROLES }).notNull().default('adult'),
    color: text().notNull().default('#4f7a5b'),
    pinHash: text().notNull(),
    /** Reset on success; drives the lockout that makes a 4-digit PIN defensible. */
    failedAttempts: integer().notNull().default(0),
    lockedUntil: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index('members_household_idx').on(table.householdId)],
)

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the cookie value — a database leak must not yield live sessions. */
    tokenHash: text().primaryKey(),
    memberId: uuid()
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('sessions_member_idx').on(table.memberId)],
)

export const locations = pgTable(
  'locations',
  {
    id: id(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    kind: text({ enum: STORAGE_KINDS }).notNull().default('pantry'),
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('locations_household_name_idx').on(table.householdId, table.name)],
)

export const products = pgTable(
  'products',
  {
    id: id(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    brand: text(),
    upc: text(),
    category: text({ enum: CATEGORIES }).notNull().default('other'),
    defaultUnit: text({ enum: UNIT_CODES }).notNull().default('each'),
    imageUrl: text(),
    parQuantity: doublePrecision(),
    parUnit: text({ enum: UNIT_CODES }),
    notes: text(),
    source: text({ enum: PRODUCT_SOURCES }).notNull().default('manual'),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (table) => [
    // Partial unique: one product per barcode, but many products with no barcode.
    uniqueIndex('products_household_upc_idx')
      .on(table.householdId, table.upc)
      .where(sql`${table.upc} is not null`),
    index('products_household_name_idx').on(table.householdId, table.name),
  ],
)

export const lots = pgTable(
  'lots',
  {
    id: id(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    locationId: uuid()
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    quantity: doublePrecision().notNull(),
    unit: text({ enum: UNIT_CODES }).notNull(),
    expiresAt: date(),
    purchasedAt: date(),
    note: text(),
    createdById: uuid().references(() => members.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [
    index('lots_household_product_idx').on(table.householdId, table.productId),
    index('lots_expires_idx').on(table.householdId, table.expiresAt),
  ],
)

export const inventoryEvents = pgTable(
  'inventory_events',
  {
    id: id(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    lotId: uuid(),
    kind: text({ enum: INVENTORY_EVENT_KINDS }).notNull(),
    quantity: doublePrecision().notNull(),
    unit: text({ enum: UNIT_CODES }).notNull(),
    memberId: uuid().references(() => members.id, { onDelete: 'set null' }),
    note: text(),
    createdAt: createdAt(),
  },
  (table) => [index('events_household_created_idx').on(table.householdId, table.createdAt)],
)

export const shoppingItems = pgTable(
  'shopping_items',
  {
    id: id(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    productId: uuid().references(() => products.id, { onDelete: 'set null' }),
    text: text().notNull(),
    quantity: doublePrecision().notNull().default(1),
    unit: text({ enum: UNIT_CODES }).notNull().default('each'),
    status: text({ enum: SHOPPING_STATUSES }).notNull().default('needed'),
    note: text(),
    /** Why this line exists, when nobody typed it. */
    autoReason: text({ enum: ['par', 'recipe', 'request'] as const }),
    requestedById: uuid().references(() => members.id, { onDelete: 'set null' }),
    boughtAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index('shopping_household_status_idx').on(table.householdId, table.status)],
)

export const requests = pgTable(
  'requests',
  {
    id: id(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    kind: text({ enum: REQUEST_KINDS }).notNull(),
    text: text().notNull(),
    note: text(),
    status: text({ enum: REQUEST_STATUSES }).notNull().default('open'),
    response: text(),
    requestedById: uuid()
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    respondedById: uuid().references(() => members.id, { onDelete: 'set null' }),
    respondedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index('requests_household_status_idx').on(table.householdId, table.status)],
)

export const recipes = pgTable(
  'recipes',
  {
    id: id(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    servings: integer().notNull().default(4),
    instructions: text(),
    sourceUrl: text(),
    tags: text().array().notNull().default([]),
    createdById: uuid().references(() => members.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [index('recipes_household_idx').on(table.householdId)],
)

export const recipeIngredients = pgTable(
  'recipe_ingredients',
  {
    id: id(),
    recipeId: uuid()
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    productId: uuid().references(() => products.id, { onDelete: 'set null' }),
    name: text().notNull(),
    quantity: doublePrecision().notNull(),
    unit: text({ enum: UNIT_CODES }).notNull(),
    optional: boolean().notNull().default(false),
    sortOrder: integer().notNull().default(0),
  },
  (table) => [index('recipe_ingredients_recipe_idx').on(table.recipeId)],
)

export const mealPlanEntries = pgTable(
  'meal_plan_entries',
  {
    id: id(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    date: date().notNull(),
    slot: text({ enum: MEAL_SLOTS }).notNull(),
    recipeId: uuid().references(() => recipes.id, { onDelete: 'set null' }),
    customText: text(),
    note: text(),
    servings: integer(),
    cookedAt: timestamp({ withTimezone: true }),
    createdById: uuid().references(() => members.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [index('meal_plan_household_date_idx').on(table.householdId, table.date)],
)

export const scanBatches = pgTable(
  'scan_batches',
  {
    id: id(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    memberId: uuid().references(() => members.id, { onDelete: 'set null' }),
    status: text({ enum: SCAN_STATUSES }).notNull().default('pending'),
    note: text(),
    error: text(),
    createdAt: createdAt(),
  },
  (table) => [index('scan_batches_household_idx').on(table.householdId, table.createdAt)],
)

export const scanCandidates = pgTable(
  'scan_candidates',
  {
    id: id(),
    batchId: uuid()
      .notNull()
      .references(() => scanBatches.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    brand: text(),
    upc: text(),
    category: text({ enum: CATEGORIES }).notNull().default('other'),
    quantity: doublePrecision().notNull().default(1),
    unit: text({ enum: UNIT_CODES }).notNull().default('each'),
    /** The model's own confidence, surfaced so a human knows what to check. */
    confidence: real().notNull().default(0),
    productId: uuid().references(() => products.id, { onDelete: 'set null' }),
    accepted: boolean().notNull().default(false),
  },
  (table) => [index('scan_candidates_batch_idx').on(table.batchId)],
)

export const householdRelations = relations(households, ({ many }) => ({
  members: many(members),
  locations: many(locations),
  products: many(products),
}))

export const productRelations = relations(products, ({ many, one }) => ({
  lots: many(lots),
  household: one(households, { fields: [products.householdId], references: [households.id] }),
}))

export const lotRelations = relations(lots, ({ one }) => ({
  product: one(products, { fields: [lots.productId], references: [products.id] }),
  location: one(locations, { fields: [lots.locationId], references: [locations.id] }),
}))

export const recipeRelations = relations(recipes, ({ many }) => ({
  ingredients: many(recipeIngredients),
}))

export const recipeIngredientRelations = relations(recipeIngredients, ({ one }) => ({
  recipe: one(recipes, { fields: [recipeIngredients.recipeId], references: [recipes.id] }),
}))

export const scanBatchRelations = relations(scanBatches, ({ many }) => ({
  candidates: many(scanCandidates),
}))

export const scanCandidateRelations = relations(scanCandidates, ({ one }) => ({
  batch: one(scanBatches, { fields: [scanCandidates.batchId], references: [scanBatches.id] }),
}))
