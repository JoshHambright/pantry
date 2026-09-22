/**
 * Pure inventory math. No database, no clock of its own — every function that
 * cares about "now" takes it as an argument, so the tests are deterministic.
 */

import { baseUnitOf, canConvert, convert, roundQuantity, unitDef, type UnitCode } from './units.js'

export interface StockLot {
  readonly id: string
  readonly quantity: number
  readonly unit: UnitCode
  /** ISO date (YYYY-MM-DD) or null when the item does not expire meaningfully. */
  readonly expiresAt?: string | null
  readonly purchasedAt?: string | null
}

export interface StockTotal {
  readonly group: string
  readonly unit: UnitCode
  /** Rounded for display — do not do further arithmetic with this. */
  readonly quantity: number
  /** Unrounded, in the group's base unit. This is what calculations use. */
  readonly baseQuantity: number
  readonly lotCount: number
}

/**
 * Pick the unit a total reads best in.
 *
 * The rule is "answer in the unit they stocked it in": someone who buys milk by
 * the gallon should be told they have half a gallon, not 1.893 L. So the unit
 * of the largest holding wins. The one refinement is that a big pile of grams
 * or millilitres promotes itself to kg or L, which is what a metric shopper
 * would have written anyway.
 */
export function preferredDisplayUnit(
  group: string,
  baseQuantity: number,
  stockedUnit?: UnitCode | undefined,
): UnitCode {
  if (stockedUnit && unitDef(stockedUnit).group === group) {
    const isMetricBase = stockedUnit === 'g' || stockedUnit === 'ml'
    if (!isMetricBase) return stockedUnit
    if (Math.abs(baseQuantity) >= 1000) return stockedUnit === 'g' ? 'kg' : 'l'
    return stockedUnit
  }
  if (group === 'mass') return Math.abs(baseQuantity) >= 1000 ? 'kg' : 'g'
  if (group === 'volume') return Math.abs(baseQuantity) >= 1000 ? 'l' : 'ml'
  if (group === 'count') return 'each'
  return group as UnitCode
}

/**
 * Sum lots into one total per conversion group. A product held as both "2 cans"
 * and "500 g" yields two totals — that is the honest answer, not a bug.
 */
export function summariseStock(lots: readonly StockLot[]): StockTotal[] {
  const byGroup = new Map<
    string,
    { base: number; lotCount: number; dominantUnit: UnitCode; dominantBase: number }
  >()

  for (const lot of lots) {
    const def = unitDef(lot.unit)
    const lotBase = lot.quantity * def.toBase
    const entry = byGroup.get(def.group) ?? {
      base: 0,
      lotCount: 0,
      dominantUnit: lot.unit,
      dominantBase: -Infinity,
    }
    entry.base += lotBase
    entry.lotCount += 1
    if (lotBase > entry.dominantBase) {
      entry.dominantBase = lotBase
      entry.dominantUnit = lot.unit
    }
    byGroup.set(def.group, entry)
  }

  return [...byGroup.entries()]
    .map(([group, { base, lotCount, dominantUnit }]) => {
      const unit = preferredDisplayUnit(group, base, dominantUnit)
      return {
        group,
        unit,
        quantity: roundQuantity(base / unitDef(unit).toBase),
        baseQuantity: base,
        lotCount,
      }
    })
    .sort((a, b) => a.group.localeCompare(b.group))
}

/**
 * Use-first ordering: soonest expiry wins, undated lots go last, and among ties
 * the oldest purchase goes first. Sorting is stable on lot id so the plan a user
 * previews is the plan that gets committed.
 */
export function sortByUseOrder(lots: readonly StockLot[]): StockLot[] {
  return [...lots].sort((a, b) => {
    if (a.expiresAt !== b.expiresAt) {
      if (!a.expiresAt) return 1
      if (!b.expiresAt) return -1
      return a.expiresAt < b.expiresAt ? -1 : 1
    }
    if (a.purchasedAt !== b.purchasedAt) {
      if (!a.purchasedAt) return 1
      if (!b.purchasedAt) return -1
      return a.purchasedAt < b.purchasedAt ? -1 : 1
    }
    return a.id.localeCompare(b.id)
  })
}

export interface ConsumptionDraw {
  readonly lotId: string
  /** Amount to remove, expressed in that lot's own unit. */
  readonly quantity: number
  readonly unit: UnitCode
}

export interface ConsumptionPlan {
  readonly draws: readonly ConsumptionDraw[]
  /** What could not be covered, in the requested unit. Zero when satisfied. */
  readonly shortfall: number
  readonly satisfied: boolean
}

/**
 * Work out which lots to draw down to cover `need`, oldest-first. Lots in an
 * incompatible unit are skipped rather than guessed at: if you need 300 g of
 * flour and hold "2 bags", we report a shortfall and let a human decide.
 */
export function planConsumption(
  lots: readonly StockLot[],
  need: { readonly quantity: number; readonly unit: UnitCode },
): ConsumptionPlan {
  if (need.quantity <= 0) return { draws: [], shortfall: 0, satisfied: true }

  const draws: ConsumptionDraw[] = []
  let remaining = need.quantity

  for (const lot of sortByUseOrder(lots)) {
    if (remaining <= 1e-9) break
    if (lot.quantity <= 0) continue
    if (!canConvert(lot.unit, need.unit)) continue

    const availableInNeedUnit = convert(lot.quantity, lot.unit, need.unit)
    const takeInNeedUnit = Math.min(availableInNeedUnit, remaining)
    const takeInLotUnit = convert(takeInNeedUnit, need.unit, lot.unit)

    draws.push({
      lotId: lot.id,
      quantity: roundQuantity(takeInLotUnit, 4),
      unit: lot.unit,
    })
    remaining -= takeInNeedUnit
  }

  const shortfall = roundQuantity(Math.max(0, remaining), 4)
  return { draws, shortfall, satisfied: shortfall <= 0 }
}

export type ExpiryStatus = 'expired' | 'soon' | 'ok' | 'none'

/** `today` and `expiresAt` are both YYYY-MM-DD, compared as plain dates. */
export function expiryStatus(
  expiresAt: string | null | undefined,
  today: string,
  soonWindowDays = 5,
): ExpiryStatus {
  if (!expiresAt) return 'none'
  if (expiresAt < today) return 'expired'
  return daysBetween(today, expiresAt) <= soonWindowDays ? 'soon' : 'ok'
}

const MS_PER_DAY = 86_400_000

/** Whole days from `from` to `to`, both YYYY-MM-DD. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN
  return Math.round((b - a) / MS_PER_DAY)
}

/**
 * How short of its par level a product is, in the par unit — this is what turns
 * "we're low on milk" into a shopping list line without anyone noticing.
 */
export function parShortfall(
  totals: readonly StockTotal[],
  par: { readonly quantity: number; readonly unit: UnitCode },
): number {
  // Deliberately reads baseQuantity, not quantity: rounding a total to three
  // decimals for display and then converting it back turns a clean "half a
  // gallon short" into 0.4999.
  const onHand = totals.reduce((sum, total) => {
    if (!canConvert(total.unit, par.unit)) return sum
    return sum + convert(total.baseQuantity, baseUnitOf(total.unit), par.unit)
  }, 0)
  return roundQuantity(Math.max(0, par.quantity - onHand), 4)
}
