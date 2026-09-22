/**
 * Units for a home pantry.
 *
 * The hard rule here: a quantity only converts inside its own *group*. Mass and
 * volume are the obvious groups. Counts are not one group — "3 cans" and
 * "3 bags" are both counts, but they are not the same thing and silently adding
 * them would corrupt the stock total. So every discrete packaging unit is its
 * own group, and only `each`/`dozen` share one.
 */

export type Dimension = 'mass' | 'volume' | 'count'

export interface UnitDef {
  readonly code: UnitCode
  readonly dimension: Dimension
  /** Quantities convert only between units sharing a group. */
  readonly group: string
  /** Multiplier to the group's base unit. */
  readonly toBase: number
  readonly label: string
  readonly plural: string
}

export const UNIT_CODES = [
  // mass
  'mg',
  'g',
  'kg',
  'oz',
  'lb',
  // volume
  'ml',
  'l',
  'tsp',
  'tbsp',
  'floz',
  'cup',
  'pt',
  'qt',
  'gal',
  // counts
  'each',
  'dozen',
  'pack',
  'can',
  'bottle',
  'jar',
  'box',
  'bag',
  'bunch',
  'head',
  'loaf',
  'roll',
] as const

export type UnitCode = (typeof UNIT_CODES)[number]

const def = (
  code: UnitCode,
  dimension: Dimension,
  group: string,
  toBase: number,
  label: string,
  plural: string,
): UnitDef => ({ code, dimension, group, toBase, label, plural })

/** A discrete packaging unit: its own group, so it never sums with another. */
const pkg = (code: UnitCode, label: string, plural: string): UnitDef =>
  def(code, 'count', code, 1, label, plural)

export const UNITS: Readonly<Record<UnitCode, UnitDef>> = {
  mg: def('mg', 'mass', 'mass', 0.001, 'mg', 'mg'),
  g: def('g', 'mass', 'mass', 1, 'g', 'g'),
  kg: def('kg', 'mass', 'mass', 1000, 'kg', 'kg'),
  oz: def('oz', 'mass', 'mass', 28.349523125, 'oz', 'oz'),
  lb: def('lb', 'mass', 'mass', 453.59237, 'lb', 'lb'),

  ml: def('ml', 'volume', 'volume', 1, 'ml', 'ml'),
  l: def('l', 'volume', 'volume', 1000, 'L', 'L'),
  tsp: def('tsp', 'volume', 'volume', 4.92892159375, 'tsp', 'tsp'),
  tbsp: def('tbsp', 'volume', 'volume', 14.78676478125, 'tbsp', 'tbsp'),
  floz: def('floz', 'volume', 'volume', 29.5735295625, 'fl oz', 'fl oz'),
  cup: def('cup', 'volume', 'volume', 236.5882365, 'cup', 'cups'),
  pt: def('pt', 'volume', 'volume', 473.176473, 'pint', 'pints'),
  qt: def('qt', 'volume', 'volume', 946.352946, 'quart', 'quarts'),
  gal: def('gal', 'volume', 'volume', 3785.411784, 'gallon', 'gallons'),

  each: def('each', 'count', 'count', 1, '', ''),
  dozen: def('dozen', 'count', 'count', 12, 'dozen', 'dozen'),
  pack: pkg('pack', 'pack', 'packs'),
  can: pkg('can', 'can', 'cans'),
  bottle: pkg('bottle', 'bottle', 'bottles'),
  jar: pkg('jar', 'jar', 'jars'),
  box: pkg('box', 'box', 'boxes'),
  bag: pkg('bag', 'bag', 'bags'),
  bunch: pkg('bunch', 'bunch', 'bunches'),
  head: pkg('head', 'head', 'heads'),
  loaf: pkg('loaf', 'loaf', 'loaves'),
  roll: pkg('roll', 'roll', 'rolls'),
}

export function isUnitCode(value: string): value is UnitCode {
  return Object.prototype.hasOwnProperty.call(UNITS, value)
}

export function unitDef(code: UnitCode): UnitDef {
  return UNITS[code]
}

/** The unit every member of a group converts through. */
export function baseUnitOf(code: UnitCode): UnitCode {
  const group = UNITS[code].group
  if (group === 'mass') return 'g'
  if (group === 'volume') return 'ml'
  if (group === 'count') return 'each'
  return code
}

export function canConvert(from: UnitCode, to: UnitCode): boolean {
  return UNITS[from].group === UNITS[to].group
}

export class IncompatibleUnitsError extends Error {
  constructor(
    readonly from: UnitCode,
    readonly to: UnitCode,
  ) {
    super(`Cannot convert ${from} to ${to}: different unit groups`)
    this.name = 'IncompatibleUnitsError'
  }
}

export function convert(quantity: number, from: UnitCode, to: UnitCode): number {
  if (!canConvert(from, to)) throw new IncompatibleUnitsError(from, to)
  if (from === to) return quantity
  return (quantity * UNITS[from].toBase) / UNITS[to].toBase
}

export function tryConvert(quantity: number, from: UnitCode, to: UnitCode): number | null {
  return canConvert(from, to) ? convert(quantity, from, to) : null
}

/** Round to a sane number of decimals — pantry quantities are not lab measurements. */
export function roundQuantity(quantity: number, decimals = 3): number {
  const factor = 10 ** decimals
  return Math.round(quantity * factor) / factor
}

const FRACTION_CHARS: Readonly<Record<string, number>> = {
  '¼': 0.25,
  '½': 0.5,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
}

const UNIT_ALIASES: Readonly<Record<string, UnitCode>> = {
  mg: 'mg',
  milligram: 'mg',
  milligrams: 'mg',
  g: 'g',
  gram: 'g',
  grams: 'g',
  gr: 'g',
  kg: 'kg',
  kilo: 'kg',
  kilos: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  oz: 'oz',
  ounce: 'oz',
  ounces: 'oz',
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
  ml: 'ml',
  milliliter: 'ml',
  milliliters: 'ml',
  millilitre: 'ml',
  millilitres: 'ml',
  l: 'l',
  liter: 'l',
  liters: 'l',
  litre: 'l',
  litres: 'l',
  tsp: 'tsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  tbsp: 'tbsp',
  tbs: 'tbsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  floz: 'floz',
  'fl oz': 'floz',
  fluidounce: 'floz',
  fluidounces: 'floz',
  cup: 'cup',
  cups: 'cup',
  c: 'cup',
  pt: 'pt',
  pint: 'pt',
  pints: 'pt',
  qt: 'qt',
  quart: 'qt',
  quarts: 'qt',
  gal: 'gal',
  gallon: 'gal',
  gallons: 'gal',
  each: 'each',
  ea: 'each',
  ct: 'each',
  count: 'each',
  piece: 'each',
  pieces: 'each',
  dozen: 'dozen',
  doz: 'dozen',
  pack: 'pack',
  packs: 'pack',
  pkg: 'pack',
  package: 'pack',
  packages: 'pack',
  can: 'can',
  cans: 'can',
  bottle: 'bottle',
  bottles: 'bottle',
  btl: 'bottle',
  jar: 'jar',
  jars: 'jar',
  box: 'box',
  boxes: 'box',
  bag: 'bag',
  bags: 'bag',
  bunch: 'bunch',
  bunches: 'bunch',
  head: 'head',
  heads: 'head',
  loaf: 'loaf',
  loaves: 'loaf',
  roll: 'roll',
  rolls: 'roll',
}

export function normaliseUnit(raw: string): UnitCode | null {
  const key = raw.trim().toLowerCase().replace(/\./g, '')
  if (isUnitCode(key)) return key
  return UNIT_ALIASES[key] ?? UNIT_ALIASES[key.replace(/\s+/g, '')] ?? null
}

export interface ParsedQuantity {
  readonly quantity: number
  readonly unit: UnitCode
  /** Whatever was left after the number and unit — usually the item name. */
  readonly remainder: string
}

/**
 * Parse the front of a free-text line: "2 lbs chicken thighs", "1 1/2 cups rice",
 * "½ gal milk", "3 bananas". A missing or unknown unit falls back to `each`,
 * which is what someone means when they write "3 bananas".
 */
export function parseQuantity(input: string): ParsedQuantity | null {
  const text = input.trim()
  if (text === '') return null

  const numberPattern = /^(\d+(?:\.\d+)?)?\s*(\d+\/\d+)?\s*([¼½¾⅓⅔⅛⅜⅝⅞])?/
  const match = numberPattern.exec(text)
  if (!match) return null

  const [whole, fraction, glyph] = [match[1], match[2], match[3]]
  if (whole === undefined && fraction === undefined && glyph === undefined) {
    // No leading number at all — treat the whole line as one item.
    return { quantity: 1, unit: 'each', remainder: text }
  }

  let quantity = whole === undefined ? 0 : Number.parseFloat(whole)
  if (fraction !== undefined) {
    const [num, den] = fraction.split('/')
    const denominator = Number.parseInt(den ?? '0', 10)
    if (denominator !== 0) quantity += Number.parseInt(num ?? '0', 10) / denominator
  }
  if (glyph !== undefined) quantity += FRACTION_CHARS[glyph] ?? 0

  const rest = text.slice(match[0].length).trim()

  // "fl oz" is the only two-word unit we accept, so try two tokens then one.
  const tokens = rest.split(/\s+/)
  for (const take of [2, 1]) {
    if (tokens.length < take) continue
    const candidate = tokens.slice(0, take).join(' ')
    const unit = normaliseUnit(candidate)
    if (unit) {
      return {
        quantity: roundQuantity(quantity),
        unit,
        remainder: tokens.slice(take).join(' ').replace(/^of\s+/i, '').trim(),
      }
    }
  }

  return { quantity: roundQuantity(quantity), unit: 'each', remainder: rest }
}

/** "1.5 kg", "2 cans", "3" — `each` prints bare, because "3 each apples" reads badly. */
export function formatQuantity(quantity: number, unit: UnitCode): string {
  const rounded = roundQuantity(quantity, 2)
  const d = UNITS[unit]
  const word = rounded === 1 ? d.label : d.plural
  if (word === '') return String(rounded)
  return `${rounded} ${word}`
}
