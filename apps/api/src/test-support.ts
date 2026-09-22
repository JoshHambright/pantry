/**
 * Test harness. These are integration tests against a real Postgres, because
 * the interesting bugs in this app live in the seams — unit conversion meeting
 * a numeric column, cascade deletes, transaction boundaries — and none of those
 * show up against a mock.
 *
 * Set TEST_DATABASE_URL to run them. Without it they skip, so `pnpm test` still
 * works on a machine with no database.
 */

import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'
import { createDb, type Db } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { loadEnv } from './env.js'
import { nullProductLookup, type ProductLookup } from './services/openfoodfacts.js'
import type { VisionItem, VisionProvider } from './services/vision.js'

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? ''
export const hasDatabase = TEST_DATABASE_URL !== ''

export interface Harness {
  app: FastifyInstance
  db: Db
  close: () => Promise<void>
  /** Replace the canned vision result the next scan will return. */
  setVisionItems: (items: VisionItem[]) => void
  setVisionError: (error: Error | null) => void
}

export function stubProductLookup(
  responses: Record<string, Awaited<ReturnType<ProductLookup['byBarcode']>>>,
): ProductLookup {
  return { byBarcode: async (upc) => responses[upc] ?? null }
}

export async function createHarness(
  options: { productLookup?: ProductLookup } = {},
): Promise<Harness> {
  let visionItems: VisionItem[] = []
  let visionError: Error | null = null

  const vision: VisionProvider = {
    available: true,
    identify: async () => {
      if (visionError) throw visionError
      return visionItems
    },
  }

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    ANTHROPIC_API_KEY: undefined,
    WEB_DIST: undefined,
  } as NodeJS.ProcessEnv)

  await runMigrations(TEST_DATABASE_URL)
  const handle = createDb(TEST_DATABASE_URL, { max: 4 })

  const app = await buildApp({
    env,
    db: handle.db,
    vision,
    productLookup: options.productLookup ?? nullProductLookup,
  })
  await app.ready()

  return {
    app,
    db: handle.db,
    close: async () => {
      await app.close()
      await handle.close()
    },
    setVisionItems: (items) => {
      visionItems = items
      visionError = null
    },
    setVisionError: (error) => {
      visionError = error
    },
  }
}

/** Households cascade to everything, so one truncate resets the world. */
export async function resetDatabase(db: Db): Promise<void> {
  await db.execute('truncate table households cascade')
}

export interface Actor {
  id: string
  cookie: string
  name: string
}

const cookieFrom = (setCookie: string | string[] | undefined): string => {
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie
  return (raw ?? '').split(';')[0] ?? ''
}

export async function bootstrapHousehold(
  app: FastifyInstance,
  options: { householdName?: string; memberName?: string; pin?: string } = {},
): Promise<Actor> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/bootstrap',
    payload: {
      householdName: options.householdName ?? 'Test House',
      memberName: options.memberName ?? 'Josh',
      pin: options.pin ?? '1234',
    },
  })
  if (response.statusCode !== 201) {
    throw new Error(`bootstrap failed: ${response.statusCode} ${response.body}`)
  }

  const body = response.json<{ id: string; name: string }>()
  return { id: body.id, name: body.name, cookie: cookieFrom(response.headers['set-cookie']) }
}

export async function addMember(
  app: FastifyInstance,
  adult: Actor,
  options: { name: string; role: 'adult' | 'child'; pin: string },
): Promise<Actor> {
  const created = await app.inject({
    method: 'POST',
    url: '/api/members',
    headers: { cookie: adult.cookie },
    payload: options,
  })
  if (created.statusCode !== 201) {
    throw new Error(`addMember failed: ${created.statusCode} ${created.body}`)
  }
  const member = created.json<{ id: string; name: string }>()

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { memberId: member.id, pin: options.pin },
  })
  if (login.statusCode !== 200) {
    throw new Error(`login failed: ${login.statusCode} ${login.body}`)
  }

  return {
    id: member.id,
    name: member.name,
    cookie: cookieFrom(login.headers['set-cookie']),
  }
}

export async function firstLocationId(app: FastifyInstance, actor: Actor): Promise<string> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/locations',
    headers: { cookie: actor.cookie },
  })
  const body = response.json<{ locations: { id: string; name: string }[] }>()
  const location = body.locations[0]
  if (!location) throw new Error('no locations were seeded')
  return location.id
}

export async function locationIdNamed(
  app: FastifyInstance,
  actor: Actor,
  name: string,
): Promise<string> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/locations',
    headers: { cookie: actor.cookie },
  })
  const body = response.json<{ locations: { id: string; name: string }[] }>()
  const location = body.locations.find((entry) => entry.name === name)
  if (!location) throw new Error(`no location named ${name}`)
  return location.id
}
