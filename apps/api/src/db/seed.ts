/**
 * Development seed. Gives a fresh checkout enough to click around: a household,
 * two adults, a kid, some stock in three places, a recipe and a plan.
 *
 * Never run this against a pantry you actually use — it refuses if a household
 * already exists, but do not rely on that as a safety net.
 */

import { hashPin } from '../auth/pin.js'
import { createDb } from './client.js'
import { loadEnv } from '../env.js'
import { isEntrypoint } from '../entrypoint.js'
import {
  households,
  locations,
  lots,
  mealPlanEntries,
  members,
  products,
  recipeIngredients,
  recipes,
  requests,
} from './schema.js'

const todayIso = (offsetDays = 0): string => {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}

export async function seed(databaseUrl: string): Promise<void> {
  const { db, close } = createDb(databaseUrl, { max: 1 })

  try {
    const existing = await db.select({ id: households.id }).from(households).limit(1)
    if (existing.length > 0) {
      console.info('a household already exists — refusing to seed over it')
      return
    }

    const [household] = await db.insert(households).values({ name: 'The Hambrights' }).returning()
    if (!household) throw new Error('could not create household')

    const pin = await hashPin('1234')
    const [josh, wife, kid] = await db
      .insert(members)
      .values([
        { householdId: household.id, name: 'Josh', role: 'adult', pinHash: pin, color: '#4f7a5b' },
        { householdId: household.id, name: 'Sarah', role: 'adult', pinHash: pin, color: '#8a5a83' },
        { householdId: household.id, name: 'Sam', role: 'child', pinHash: pin, color: '#b07d3e' },
      ])
      .returning()

    const [pantryShelf, fridge, freezer] = await db
      .insert(locations)
      .values([
        { householdId: household.id, name: 'Pantry', kind: 'pantry', sortOrder: 0 },
        { householdId: household.id, name: 'Fridge', kind: 'fridge', sortOrder: 1 },
        { householdId: household.id, name: 'Freezer', kind: 'freezer', sortOrder: 2 },
      ])
      .returning()

    const productRows = await db
      .insert(products)
      .values([
        {
          householdId: household.id,
          name: 'Milk',
          category: 'dairy',
          defaultUnit: 'gal',
          parQuantity: 1,
          parUnit: 'gal',
        },
        { householdId: household.id, name: 'Rice', category: 'pantry', defaultUnit: 'lb' },
        { householdId: household.id, name: 'Eggs', category: 'dairy', defaultUnit: 'each' },
        {
          householdId: household.id,
          name: 'Chicken thighs',
          category: 'meat',
          defaultUnit: 'lb',
        },
        { householdId: household.id, name: 'Black beans', category: 'canned', defaultUnit: 'can' },
        { householdId: household.id, name: 'Tortillas', category: 'bakery', defaultUnit: 'pack' },
      ])
      .returning()

    const byName = new Map(productRows.map((row) => [row.name, row]))
    const id = (name: string): string => {
      const row = byName.get(name)
      if (!row) throw new Error(`seed product missing: ${name}`)
      return row.id
    }

    await db.insert(lots).values([
      {
        householdId: household.id,
        productId: id('Milk'),
        locationId: fridge!.id,
        quantity: 0.5,
        unit: 'gal',
        expiresAt: todayIso(3),
        purchasedAt: todayIso(-4),
        createdById: josh!.id,
      },
      {
        householdId: household.id,
        productId: id('Rice'),
        locationId: pantryShelf!.id,
        quantity: 4,
        unit: 'lb',
        purchasedAt: todayIso(-30),
        createdById: josh!.id,
      },
      {
        householdId: household.id,
        productId: id('Eggs'),
        locationId: fridge!.id,
        quantity: 8,
        unit: 'each',
        expiresAt: todayIso(12),
        createdById: wife!.id,
      },
      {
        householdId: household.id,
        productId: id('Chicken thighs'),
        locationId: freezer!.id,
        quantity: 3,
        unit: 'lb',
        createdById: wife!.id,
      },
      {
        householdId: household.id,
        productId: id('Black beans'),
        locationId: pantryShelf!.id,
        quantity: 4,
        unit: 'can',
        createdById: josh!.id,
      },
      {
        householdId: household.id,
        productId: id('Tortillas'),
        locationId: pantryShelf!.id,
        quantity: 1,
        unit: 'pack',
        expiresAt: todayIso(-2),
        createdById: josh!.id,
      },
    ])

    const [tacos] = await db
      .insert(recipes)
      .values({
        householdId: household.id,
        name: 'Chicken tacos',
        servings: 4,
        instructions: 'Season and sear the chicken. Warm the tortillas. Assemble.',
        tags: ['quick', 'family'],
        createdById: josh!.id,
      })
      .returning()

    await db.insert(recipeIngredients).values([
      {
        recipeId: tacos!.id,
        productId: id('Chicken thighs'),
        name: 'Chicken thighs',
        quantity: 1.5,
        unit: 'lb',
        sortOrder: 0,
      },
      {
        recipeId: tacos!.id,
        productId: id('Tortillas'),
        name: 'Tortillas',
        quantity: 1,
        unit: 'pack',
        sortOrder: 1,
      },
      {
        recipeId: tacos!.id,
        productId: id('Black beans'),
        name: 'Black beans',
        quantity: 1,
        unit: 'can',
        sortOrder: 2,
      },
      {
        recipeId: tacos!.id,
        name: 'Lime',
        quantity: 2,
        unit: 'each',
        optional: true,
        sortOrder: 3,
      },
    ])

    await db.insert(mealPlanEntries).values({
      householdId: household.id,
      date: todayIso(),
      slot: 'dinner',
      recipeId: tacos!.id,
      createdById: josh!.id,
    })

    await db.insert(requests).values({
      householdId: household.id,
      kind: 'meal',
      text: 'Can we have spaghetti this week?',
      requestedById: kid!.id,
    })

    console.info('seeded. everyone’s PIN is 1234')
  } finally {
    await close()
  }
}

if (isEntrypoint(import.meta.url)) {
  const env = loadEnv()
  seed(env.DATABASE_URL)
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error('seed failed', error)
      process.exit(1)
    })
}
