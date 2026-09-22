/**
 * Everything that reads or moves stock.
 *
 * Assembly happens in JavaScript rather than SQL: a household holds hundreds of
 * products, not millions, and the unit rules in @pantry/shared are already
 * written and tested there. Pushing them into SQL would duplicate the logic in
 * a place the tests cannot reach.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import {
  expiryStatus,
  parShortfall,
  planConsumption,
  summariseStock,
  type ExpiryStatus,
  type InventoryEvent,
  type Lot,
  type Product,
  type StockLot,
  type StockRow,
  type UnitCode,
} from '@pantry/shared'
import type { Db } from '../db/client.js'
import { inventoryEvents, locations, lots, members, products } from '../db/schema.js'
import { badRequest, conflict, notFound } from '../errors.js'

export const todayIso = (now: Date = new Date()): string => now.toISOString().slice(0, 10)

const EXPIRY_RANK: Record<ExpiryStatus, number> = { expired: 0, soon: 1, ok: 2, none: 3 }

function worstOf(statuses: readonly ExpiryStatus[]): ExpiryStatus {
  return statuses.reduce<ExpiryStatus>(
    (worst, next) => (EXPIRY_RANK[next] < EXPIRY_RANK[worst] ? next : worst),
    'none',
  )
}

export interface LoadStockOptions {
  productIds?: string[] | undefined
  /** Include products with no lots left — the catalogue view wants them. */
  includeEmpty?: boolean | undefined
  today?: string | undefined
}

export async function loadStockRows(
  db: Db,
  householdId: string,
  options: LoadStockOptions = {},
): Promise<StockRow[]> {
  const today = options.today ?? todayIso()

  const productFilter = options.productIds?.length
    ? and(eq(products.householdId, householdId), inArray(products.id, options.productIds))
    : eq(products.householdId, householdId)

  const productRows = await db.select().from(products).where(productFilter)
  if (productRows.length === 0) return []

  const lotRows = await db
    .select({
      lot: lots,
      locationName: locations.name,
    })
    .from(lots)
    .innerJoin(locations, eq(locations.id, lots.locationId))
    .where(
      and(
        eq(lots.householdId, householdId),
        inArray(
          lots.productId,
          productRows.map((row) => row.id),
        ),
        sql`${lots.quantity} > 0`,
      ),
    )

  const byProduct = new Map<string, typeof lotRows>()
  for (const row of lotRows) {
    const existing = byProduct.get(row.lot.productId)
    if (existing) existing.push(row)
    else byProduct.set(row.lot.productId, [row])
  }

  const rows: StockRow[] = productRows.map((product) => {
    const productLots = byProduct.get(product.id) ?? []
    const stockLots: StockLot[] = productLots.map((row) => ({
      id: row.lot.id,
      quantity: row.lot.quantity,
      unit: row.lot.unit,
      expiresAt: row.lot.expiresAt,
      purchasedAt: row.lot.purchasedAt,
    }))

    const totals = summariseStock(stockLots)
    const decorated = productLots
      .map((row) => ({
        id: row.lot.id,
        productId: row.lot.productId,
        locationId: row.lot.locationId,
        quantity: row.lot.quantity,
        unit: row.lot.unit,
        expiresAt: row.lot.expiresAt,
        purchasedAt: row.lot.purchasedAt,
        note: row.lot.note,
        createdAt: row.lot.createdAt.toISOString(),
        locationName: row.locationName,
        expiry: expiryStatus(row.lot.expiresAt, today),
      }))
      .sort((a, b) => EXPIRY_RANK[a.expiry] - EXPIRY_RANK[b.expiry])

    const expiryDates = decorated
      .map((entry) => entry.expiresAt)
      .filter((value): value is string => value !== null)
      .sort()

    return {
      product: toProduct(product),
      totals,
      lots: decorated,
      parShortfall:
        product.parQuantity !== null && product.parUnit !== null
          ? parShortfall(totals, { quantity: product.parQuantity, unit: product.parUnit })
          : null,
      soonestExpiry: expiryDates[0] ?? null,
      worstExpiry: worstOf(decorated.map((entry) => entry.expiry)),
    }
  })

  const visible = options.includeEmpty ? rows : rows.filter((row) => row.lots.length > 0)
  return visible.sort((a, b) => a.product.name.localeCompare(b.product.name))
}

type ProductRow = typeof products.$inferSelect

export function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    upc: row.upc,
    category: row.category,
    defaultUnit: row.defaultUnit,
    imageUrl: row.imageUrl,
    parQuantity: row.parQuantity,
    parUnit: row.parUnit,
    notes: row.notes,
    source: row.source,
  }
}

export function toLot(row: typeof lots.$inferSelect): Lot {
  return {
    id: row.id,
    productId: row.productId,
    locationId: row.locationId,
    quantity: row.quantity,
    unit: row.unit,
    expiresAt: row.expiresAt,
    purchasedAt: row.purchasedAt,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  }
}

export interface AddStockArgs {
  householdId: string
  memberId: string
  productId: string
  locationId: string
  quantity: number
  unit: UnitCode
  expiresAt?: string | null | undefined
  purchasedAt?: string | null | undefined
  note?: string | null | undefined
}

export async function addStock(db: Db, args: AddStockArgs): Promise<Lot> {
  const [location] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.id, args.locationId), eq(locations.householdId, args.householdId)))
    .limit(1)
  if (!location) throw notFound('Location')

  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, args.productId), eq(products.householdId, args.householdId)))
    .limit(1)
  if (!product) throw notFound('Product')

  const [inserted] = await db
    .insert(lots)
    .values({
      householdId: args.householdId,
      productId: args.productId,
      locationId: args.locationId,
      quantity: args.quantity,
      unit: args.unit,
      expiresAt: args.expiresAt ?? null,
      purchasedAt: args.purchasedAt ?? todayIso(),
      note: args.note ?? null,
      createdById: args.memberId,
    })
    .returning()
  if (!inserted) throw conflict('Could not add that to the inventory')

  await db.insert(inventoryEvents).values({
    householdId: args.householdId,
    productId: args.productId,
    lotId: inserted.id,
    kind: 'added',
    quantity: args.quantity,
    unit: args.unit,
    memberId: args.memberId,
    note: args.note ?? null,
  })

  return toLot(inserted)
}

export interface ConsumeArgs {
  householdId: string
  memberId: string
  productId: string
  quantity: number
  unit: UnitCode
  note?: string | null | undefined
  kind?: 'consumed' | 'discarded'
}

export interface ConsumeResult {
  consumed: number
  unit: UnitCode
  shortfall: number
  emptiedLotIds: string[]
}

/**
 * Draw stock down oldest-first. The plan comes from @pantry/shared so the
 * preview the UI shows and the write that happens here agree exactly.
 */
export async function consumeStock(db: Db, args: ConsumeArgs): Promise<ConsumeResult> {
  const existing = await db
    .select()
    .from(lots)
    .where(
      and(
        eq(lots.householdId, args.householdId),
        eq(lots.productId, args.productId),
        sql`${lots.quantity} > 0`,
      ),
    )

  if (existing.length === 0) throw conflict('There is none of that on hand')

  const plan = planConsumption(
    existing.map((row) => ({
      id: row.id,
      quantity: row.quantity,
      unit: row.unit,
      expiresAt: row.expiresAt,
      purchasedAt: row.purchasedAt,
    })),
    { quantity: args.quantity, unit: args.unit },
  )

  if (plan.draws.length === 0) {
    throw badRequest(
      'None of what is on hand is measured in a unit that can cover that. Adjust the lot directly instead.',
    )
  }

  const byId = new Map(existing.map((row) => [row.id, row]))
  const emptiedLotIds: string[] = []

  for (const draw of plan.draws) {
    const row = byId.get(draw.lotId)
    if (!row) continue
    const next = Math.max(0, row.quantity - draw.quantity)
    // Below a gram or a hundredth of an item, call it empty rather than leaving dust.
    const cleared = next < 1e-6
    await db
      .update(lots)
      .set({ quantity: cleared ? 0 : next })
      .where(eq(lots.id, draw.lotId))
    if (cleared) emptiedLotIds.push(draw.lotId)
  }

  await db.insert(inventoryEvents).values({
    householdId: args.householdId,
    productId: args.productId,
    lotId: null,
    kind: args.kind ?? 'consumed',
    quantity: args.quantity - plan.shortfall,
    unit: args.unit,
    memberId: args.memberId,
    note: args.note ?? null,
  })

  // Empty lots are deleted rather than kept at zero: the history lives in events.
  if (emptiedLotIds.length > 0) {
    await db.delete(lots).where(inArray(lots.id, emptiedLotIds))
  }

  return {
    consumed: args.quantity - plan.shortfall,
    unit: args.unit,
    shortfall: plan.shortfall,
    emptiedLotIds,
  }
}

export async function loadRecentEvents(
  db: Db,
  householdId: string,
  limit = 50,
): Promise<InventoryEvent[]> {
  const rows = await db
    .select({
      event: inventoryEvents,
      productName: products.name,
      memberName: members.name,
    })
    .from(inventoryEvents)
    .innerJoin(products, eq(products.id, inventoryEvents.productId))
    .leftJoin(members, eq(members.id, inventoryEvents.memberId))
    .where(eq(inventoryEvents.householdId, householdId))
    .orderBy(desc(inventoryEvents.createdAt))
    .limit(limit)

  return rows.map((row) => ({
    id: row.event.id,
    kind: row.event.kind,
    productId: row.event.productId,
    productName: row.productName,
    quantity: row.event.quantity,
    unit: row.event.unit,
    memberId: row.event.memberId,
    memberName: row.memberName,
    note: row.event.note,
    createdAt: row.event.createdAt.toISOString(),
  }))
}
