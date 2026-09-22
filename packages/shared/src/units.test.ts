import { describe, expect, it } from 'vitest'
import {
  canConvert,
  convert,
  formatQuantity,
  IncompatibleUnitsError,
  normaliseUnit,
  parseQuantity,
  roundQuantity,
  UNIT_CODES,
  UNITS,
} from './units.js'

describe('unit table', () => {
  it('defines every advertised code', () => {
    for (const code of UNIT_CODES) {
      expect(UNITS[code]?.code).toBe(code)
    }
  })

  it('gives each packaging unit its own conversion group', () => {
    expect(UNITS.can.group).toBe('can')
    expect(UNITS.bag.group).toBe('bag')
    expect(UNITS.can.group).not.toBe(UNITS.bag.group)
  })

  it('shares one group between each and dozen', () => {
    expect(UNITS.each.group).toBe(UNITS.dozen.group)
  })
})

describe('convert', () => {
  it('converts within mass', () => {
    expect(convert(1, 'kg', 'g')).toBe(1000)
    expect(convert(2, 'lb', 'oz')).toBeCloseTo(32, 6)
    expect(roundQuantity(convert(16, 'oz', 'lb'))).toBe(1)
  })

  it('converts within volume', () => {
    expect(convert(1, 'l', 'ml')).toBe(1000)
    expect(roundQuantity(convert(1, 'cup', 'tbsp'))).toBe(16)
    expect(roundQuantity(convert(4, 'qt', 'gal'))).toBe(1)
  })

  it('converts a dozen to twelve', () => {
    expect(convert(1, 'dozen', 'each')).toBe(12)
    expect(convert(24, 'each', 'dozen')).toBe(2)
  })

  it('is identity for the same unit', () => {
    expect(convert(7.5, 'cup', 'cup')).toBe(7.5)
  })

  it('refuses to cross dimensions', () => {
    expect(canConvert('g', 'ml')).toBe(false)
    expect(() => convert(1, 'g', 'ml')).toThrow(IncompatibleUnitsError)
  })

  it('refuses to equate different packaging units', () => {
    // The whole point: 3 cans is not 3 bags.
    expect(canConvert('can', 'bag')).toBe(false)
    expect(() => convert(3, 'can', 'bag')).toThrow(IncompatibleUnitsError)
  })

  it('refuses to turn cans into grams', () => {
    expect(canConvert('can', 'g')).toBe(false)
  })

  it('round-trips without drift beyond rounding', () => {
    const there = convert(2.5, 'lb', 'g')
    expect(roundQuantity(convert(there, 'g', 'lb'))).toBe(2.5)
  })
})

describe('normaliseUnit', () => {
  it.each([
    ['lbs', 'lb'],
    ['Pounds', 'lb'],
    ['OZ', 'oz'],
    ['tablespoons', 'tbsp'],
    ['fl oz', 'floz'],
    ['litres', 'l'],
    ['ct', 'each'],
    ['pkg', 'pack'],
    ['loaves', 'loaf'],
    ['g.', 'g'],
  ])('maps %s to %s', (input, expected) => {
    expect(normaliseUnit(input)).toBe(expected)
  })

  it('returns null for a word that is not a unit', () => {
    expect(normaliseUnit('chicken')).toBeNull()
  })
})

describe('parseQuantity', () => {
  it('parses a plain amount and unit', () => {
    expect(parseQuantity('2 lbs chicken thighs')).toEqual({
      quantity: 2,
      unit: 'lb',
      remainder: 'chicken thighs',
    })
  })

  it('parses a mixed fraction', () => {
    const parsed = parseQuantity('1 1/2 cups rice')
    expect(parsed?.quantity).toBe(1.5)
    expect(parsed?.unit).toBe('cup')
    expect(parsed?.remainder).toBe('rice')
  })

  it('parses a bare fraction', () => {
    expect(parseQuantity('1/4 tsp salt')?.quantity).toBe(0.25)
  })

  it('parses a unicode fraction glyph', () => {
    const parsed = parseQuantity('½ gal milk')
    expect(parsed?.quantity).toBe(0.5)
    expect(parsed?.unit).toBe('gal')
    expect(parsed?.remainder).toBe('milk')
  })

  it('defaults to each when a count has no unit', () => {
    expect(parseQuantity('3 bananas')).toEqual({
      quantity: 3,
      unit: 'each',
      remainder: 'bananas',
    })
  })

  it('assumes one of a bare item', () => {
    expect(parseQuantity('sourdough bread')).toEqual({
      quantity: 1,
      unit: 'each',
      remainder: 'sourdough bread',
    })
  })

  it('drops a connecting "of"', () => {
    expect(parseQuantity('2 cups of flour')?.remainder).toBe('flour')
  })

  it('handles a two-word unit', () => {
    const parsed = parseQuantity('8 fl oz cream')
    expect(parsed?.unit).toBe('floz')
    expect(parsed?.remainder).toBe('cream')
  })

  it('returns null for empty input', () => {
    expect(parseQuantity('   ')).toBeNull()
  })

  it('never divides by zero on a malformed fraction', () => {
    expect(parseQuantity('1/0 cups flour')?.quantity).toBe(1)
  })
})

describe('formatQuantity', () => {
  it('prints counts bare', () => {
    expect(formatQuantity(3, 'each')).toBe('3')
  })

  it('pluralises packaging units', () => {
    expect(formatQuantity(1, 'can')).toBe('1 can')
    expect(formatQuantity(2, 'can')).toBe('2 cans')
    expect(formatQuantity(3, 'loaf')).toBe('3 loaves')
  })

  it('rounds display to two decimals', () => {
    expect(formatQuantity(1.4999, 'kg')).toBe('1.5 kg')
  })
})
