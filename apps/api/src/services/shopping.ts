/**
 * The shopping list, and the paths that fill it automatically: par levels that
 * have dropped, recipe shortfalls, and approved requests from the family.
 */

import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import { formatQuantity, type ShoppingItem, type UnitCode } from '@pantry/shared'
import type { Db } from '../db/client.js'
import { members, products, shoppingItems } from '../db/schema.js'
import { notFound } from '../errors.js'
import { addStock, loadStockRows, todayIso } from './stock.js'

type ShoppingRow = typeof shoppingItems.$inferSelect

export function toShoppingItem(
  row: ShoppingRow,
  requestedByName: string | null = null,
): ShoppingItem {
  return {
    id: row.id,
    productId: row.productId,
    text: row.text,
    quantity: row.quantity,
    unit: row.unit,
    status: row.status,
    note: row.note,
    autoReason: row.autoReason,
    requestedById: row.requestedById,
    requestedByName,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function loadShoppingList(db: Db, householdId: string): Promise<ShoppingItem[]> {
  const rows = await db
    .select({ item: shoppingItems, memberName: members.name })
    .from(shoppingItems)
    .leftJoin(members, eq(members.id, shoppingItems.requestedById))
    .where(eq(shoppingItems.householdId, householdId))
    .orderBy(desc(shoppingItems.createdAt))

  return rows.map((row) => toShoppingItem(row.item, row.memberName))
}

/**
 * Add a line unless an open one already covers it. Without this guard, every
 * par-level sweep would pile up another "milk" every time it ran.
 */
export async function addIfAbsent(
  db: Db,
  args: {
    householdId: string
    productId?: string | null
    text: string
    quantity: number
    unit: UnitCode
    autoReason?: 'par' | 'recipe' | 'request' | null
    requestedById?: string | null
    note?: string | null
  },
): Promise<ShoppingItem | null> {
  const openForHousehold = and(
    eq(shoppingItems.householdId, args.householdId),
    or(eq(shoppingItems.status, 'needed'), eq(shoppingItems.status, 'in_cart')),
  )

  const duplicateMatch = args.productId
    ? and(openForHousehold, eq(shoppingItems.productId, args.productId))
    : and(
        openForHousehold,
        isNull(shoppingItems.productId),
        eq(shoppingItems.text, args.text.trim()),
      )

  const [existing] = await db.select().from(shoppingItems).where(duplicateMatch).limit(1)
  if (existing) return null

  const [inserted] = await db
    .insert(shoppingItems)
    .values({
      householdId: args.householdId,
      productId: args.productId ?? null,
      text: args.text.trim(),
      quantity: args.quantity,
      unit: args.unit,
      autoReason: args.autoReason ?? null,
      requestedById: args.requestedById ?? null,
      note: args.note ?? null,
    })
    .returning()

  return inserted ? toShoppingItem(inserted) : null
}

/**
 * Sweep every product with a par level and queue whatever has fallen below it.
 * Runs on demand from the shopping screen rather than on a timer — a household
 * server should not surprise anyone with background writes.
 */
export async function refillFromParLevels(
  db: Db,
  householdId: string,
): Promise<{ added: ShoppingItem[] }> {
  const rows = await loadStockRows(db, householdId, { includeEmpty: true })
  const added: ShoppingItem[] = []

  for (const row of rows) {
    const { product } = row
    if (product.parQuantity === null || product.parUnit === null) continue
    if (row.parShortfall === null || row.parShortfall <= 0) continue

    const item = await addIfAbsent(db, {
      householdId,
      productId: product.id,
      text: product.name,
      quantity: row.parShortfall,
      unit: product.parUnit,
      autoReason: 'par',
      note: `Below par (${formatQuantity(product.parQuantity, product.parUnit)})`,
    })
    if (item) added.push(item)
  }

  return { added }
}

export interface CheckoutResult {
  added: number
  skipped: number
}

/**
 * Turn bought lines into stock at the end of a trip. Free-text lines have no
 * product to add against, so they are marked bought and left alone rather than
 * silently creating a half-formed product.
 */
export async function checkoutItems(
  db: Db,
  args: {
    householdId: string
    memberId: string
    locationId: string
    itemIds: string[]
    purchasedAt?: string | undefined
  },
): Promise<CheckoutResult> {
  const rows = await db
    .select()
    .from(shoppingItems)
    .where(
      and(eq(shoppingItems.householdId, args.householdId), inArray(shoppingItems.id, args.itemIds)),
    )
  if (rows.length === 0) throw notFound('Shopping items')

  const purchasedAt = args.purchasedAt ?? todayIso()
  let added = 0
  let skipped = 0

  for (const row of rows) {
    if (row.productId) {
      await addStock(db, {
        householdId: args.householdId,
        memberId: args.memberId,
        productId: row.productId,
        locationId: args.locationId,
        quantity: row.quantity,
        unit: row.unit,
        purchasedAt,
        note: null,
      })
      added += 1
    } else {
      skipped += 1
    }

    await db
      .update(shoppingItems)
      .set({ status: 'bought', boughtAt: new Date() })
      .where(eq(shoppingItems.id, row.id))
  }

  return { added, skipped }
}

/** Products whose name matches a free-text line, offered as a link on the list. */
export async function suggestProductsFor(
  db: Db,
  householdId: string,
  text: string,
): Promise<{ id: string; name: string }[]> {
  const key = text.toLowerCase().trim()
  if (key === '') return []

  const rows = await db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(eq(products.householdId, householdId))

  return rows
    .filter((row) => row.name.toLowerCase().includes(key) || key.includes(row.name.toLowerCase()))
    .slice(0, 5)
}
