import { describe, expect, it } from 'vitest'
import {
  daysBetween,
  expiryStatus,
  parShortfall,
  planConsumption,
  sortByUseOrder,
  summariseStock,
  type StockLot,
} from './inventory.js'

const lot = (over: Partial<StockLot> & Pick<StockLot, 'id' | 'quantity' | 'unit'>): StockLot => ({
  expiresAt: null,
  purchasedAt: null,
  ...over,
})

describe('summariseStock', () => {
  it('sums convertible lots into one total', () => {
    const totals = summariseStock([
      lot({ id: 'a', quantity: 500, unit: 'g' }),
      lot({ id: 'b', quantity: 1, unit: 'kg' }),
    ])
    expect(totals).toHaveLength(1)
    expect(totals[0]).toMatchObject({ group: 'mass', unit: 'kg', quantity: 1.5, lotCount: 2 })
    // The base figure stays unrounded so later arithmetic does not drift.
    expect(totals[0]?.baseQuantity).toBe(1500)
  })

  it('keeps a small mass in grams', () => {
    const totals = summariseStock([lot({ id: 'a', quantity: 800, unit: 'g' })])
    expect(totals[0]).toMatchObject({ unit: 'g', quantity: 800 })
  })

  it('reports incompatible holdings separately rather than inventing a total', () => {
    const totals = summariseStock([
      lot({ id: 'a', quantity: 2, unit: 'can' }),
      lot({ id: 'b', quantity: 500, unit: 'g' }),
    ])
    expect(totals).toHaveLength(2)
    expect(totals.map((t) => t.group).sort()).toEqual(['can', 'mass'])
  })

  it('answers in the unit the food was stocked in', () => {
    // 3 lb minus 1.5 lb should read as pounds, not as 680 grams.
    const totals = summariseStock([lot({ id: 'a', quantity: 1.5, unit: 'lb' })])
    expect(totals[0]).toMatchObject({ unit: 'lb', quantity: 1.5 })
  })

  it('keeps an imperial volume imperial', () => {
    const totals = summariseStock([lot({ id: 'a', quantity: 0.5, unit: 'gal' })])
    expect(totals[0]).toMatchObject({ unit: 'gal', quantity: 0.5 })
  })

  it('lets the largest holding choose the unit', () => {
    const totals = summariseStock([
      lot({ id: 'small', quantity: 50, unit: 'g' }),
      lot({ id: 'big', quantity: 2, unit: 'lb' }),
    ])
    expect(totals[0]?.unit).toBe('lb')
  })

  it('promotes a big pile of grams to kilograms', () => {
    const totals = summariseStock([lot({ id: 'a', quantity: 1500, unit: 'g' })])
    expect(totals[0]).toMatchObject({ unit: 'kg', quantity: 1.5 })
  })

  it('returns nothing for no lots', () => {
    expect(summariseStock([])).toEqual([])
  })
})

describe('sortByUseOrder', () => {
  it('puts the soonest expiry first and undated last', () => {
    const order = sortByUseOrder([
      lot({ id: 'none', quantity: 1, unit: 'each' }),
      lot({ id: 'late', quantity: 1, unit: 'each', expiresAt: '2026-10-01' }),
      lot({ id: 'soon', quantity: 1, unit: 'each', expiresAt: '2026-09-24' }),
    ]).map((l) => l.id)
    expect(order).toEqual(['soon', 'late', 'none'])
  })

  it('breaks an expiry tie with the older purchase', () => {
    const order = sortByUseOrder([
      lot({ id: 'new', quantity: 1, unit: 'each', purchasedAt: '2026-09-20' }),
      lot({ id: 'old', quantity: 1, unit: 'each', purchasedAt: '2026-09-01' }),
    ]).map((l) => l.id)
    expect(order).toEqual(['old', 'new'])
  })

  it('is stable on id so a previewed plan is the committed plan', () => {
    const order = sortByUseOrder([
      lot({ id: 'b', quantity: 1, unit: 'each' }),
      lot({ id: 'a', quantity: 1, unit: 'each' }),
    ]).map((l) => l.id)
    expect(order).toEqual(['a', 'b'])
  })

  it('does not mutate its input', () => {
    const input = [
      lot({ id: 'b', quantity: 1, unit: 'each' }),
      lot({ id: 'a', quantity: 1, unit: 'each' }),
    ]
    sortByUseOrder(input)
    expect(input.map((l) => l.id)).toEqual(['b', 'a'])
  })
})

describe('planConsumption', () => {
  it('draws entirely from one lot when it covers the need', () => {
    const plan = planConsumption([lot({ id: 'a', quantity: 1, unit: 'kg' })], {
      quantity: 300,
      unit: 'g',
    })
    expect(plan.satisfied).toBe(true)
    expect(plan.draws).toEqual([{ lotId: 'a', quantity: 0.3, unit: 'kg' }])
    expect(plan.shortfall).toBe(0)
  })

  it('spills over into the next lot, oldest first', () => {
    const plan = planConsumption(
      [
        lot({ id: 'fresh', quantity: 500, unit: 'g', expiresAt: '2026-12-01' }),
        lot({ id: 'expiring', quantity: 200, unit: 'g', expiresAt: '2026-09-25' }),
      ],
      { quantity: 600, unit: 'g' },
    )
    expect(plan.satisfied).toBe(true)
    expect(plan.draws).toEqual([
      { lotId: 'expiring', quantity: 200, unit: 'g' },
      { lotId: 'fresh', quantity: 400, unit: 'g' },
    ])
  })

  it('reports a shortfall rather than over-drawing', () => {
    const plan = planConsumption([lot({ id: 'a', quantity: 100, unit: 'g' })], {
      quantity: 250,
      unit: 'g',
    })
    expect(plan.satisfied).toBe(false)
    expect(plan.shortfall).toBe(150)
    expect(plan.draws).toEqual([{ lotId: 'a', quantity: 100, unit: 'g' }])
  })

  it('skips lots it cannot convert instead of guessing', () => {
    const plan = planConsumption(
      [
        lot({ id: 'bags', quantity: 2, unit: 'bag' }),
        lot({ id: 'loose', quantity: 100, unit: 'g' }),
      ],
      { quantity: 250, unit: 'g' },
    )
    expect(plan.draws.map((d) => d.lotId)).toEqual(['loose'])
    expect(plan.shortfall).toBe(150)
  })

  it('ignores empty and negative lots', () => {
    const plan = planConsumption(
      [lot({ id: 'empty', quantity: 0, unit: 'g' }), lot({ id: 'real', quantity: 50, unit: 'g' })],
      { quantity: 50, unit: 'g' },
    )
    expect(plan.draws).toEqual([{ lotId: 'real', quantity: 50, unit: 'g' }])
  })

  it('treats a zero need as already satisfied', () => {
    expect(
      planConsumption([lot({ id: 'a', quantity: 5, unit: 'g' })], { quantity: 0, unit: 'g' }),
    ).toEqual({ draws: [], shortfall: 0, satisfied: true })
  })

  it('handles a need with nothing on hand', () => {
    const plan = planConsumption([], { quantity: 2, unit: 'cup' })
    expect(plan).toEqual({ draws: [], shortfall: 2, satisfied: false })
  })

  it('expresses each draw in that lot’s own unit', () => {
    const plan = planConsumption([lot({ id: 'a', quantity: 2, unit: 'lb' })], {
      quantity: 100,
      unit: 'g',
    })
    expect(plan.draws[0]?.unit).toBe('lb')
    expect(plan.draws[0]?.quantity).toBeCloseTo(0.2205, 3)
  })
})

describe('expiryStatus', () => {
  const today = '2026-09-22'

  it('flags a past date as expired', () => {
    expect(expiryStatus('2026-09-21', today)).toBe('expired')
  })

  it('flags today as due, not expired', () => {
    expect(expiryStatus(today, today)).toBe('soon')
  })

  it('flags the edge of the window as soon', () => {
    expect(expiryStatus('2026-09-27', today)).toBe('soon')
  })

  it('leaves a distant date alone', () => {
    expect(expiryStatus('2026-09-28', today)).toBe('ok')
  })

  it('reports none when nothing is set', () => {
    expect(expiryStatus(null, today)).toBe('none')
    expect(expiryStatus(undefined, today)).toBe('none')
  })

  it('respects a custom window', () => {
    expect(expiryStatus('2026-10-01', today, 30)).toBe('soon')
  })
})

describe('daysBetween', () => {
  it('counts forward', () => {
    expect(daysBetween('2026-09-22', '2026-09-25')).toBe(3)
  })

  it('counts backward as negative', () => {
    expect(daysBetween('2026-09-25', '2026-09-22')).toBe(-3)
  })

  it('crosses a month boundary', () => {
    expect(daysBetween('2026-09-30', '2026-10-01')).toBe(1)
  })
})

describe('parShortfall', () => {
  it('reports how much is missing', () => {
    const totals = summariseStock([lot({ id: 'a', quantity: 1, unit: 'l' })])
    expect(parShortfall(totals, { quantity: 2, unit: 'l' })).toBe(1)
  })

  it('is zero when stocked at or above par', () => {
    const totals = summariseStock([lot({ id: 'a', quantity: 3, unit: 'l' })])
    expect(parShortfall(totals, { quantity: 2, unit: 'l' })).toBe(0)
  })

  it('ignores holdings in an unconvertible unit', () => {
    const totals = summariseStock([lot({ id: 'a', quantity: 4, unit: 'can' })])
    expect(parShortfall(totals, { quantity: 2, unit: 'l' })).toBe(2)
  })

  it('counts the full par as missing when nothing is on hand', () => {
    expect(parShortfall([], { quantity: 2, unit: 'each' })).toBe(2)
  })

  it('does not let display rounding leak into the arithmetic', () => {
    // Half a gallon summarises as 1.893 L once rounded for display. Converting
    // that back would report a shortfall of 0.4999 gal instead of exactly 0.5.
    const totals = summariseStock([lot({ id: 'a', quantity: 0.5, unit: 'gal' })])
    expect(parShortfall(totals, { quantity: 1, unit: 'gal' })).toBe(0.5)
  })
})
