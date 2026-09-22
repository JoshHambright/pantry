/**
 * The real API, with a canned vision provider.
 *
 * Photo scanning is the one feature that costs money per use, which makes it
 * the one feature nobody exercises by hand. This serves the actual app with a
 * fixed list of candidates so the review-and-confirm flow can be driven — by a
 * person or by scripts/ui-walkthrough.mjs — for free and deterministically.
 *
 *   pnpm build
 *   DATABASE_URL=... node scripts/stub-vision-server.mjs
 *
 * The candidates are chosen to cover the cases that matter: a high-confidence
 * count, a branded item, a weight, something that should match an existing
 * product, and one below the 0.6 confidence bar so it starts unticked.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const api = join(root, 'apps/api/dist')

const { buildApp } = await import(join(api, 'app.js'))
const { createDb } = await import(join(api, 'db/client.js'))
const { loadEnv } = await import(join(api, 'env.js'))
const { nullProductLookup } = await import(join(api, 'services/openfoodfacts.js'))

const PORT = Number(process.env.PORT ?? 8098)

const CANDIDATES = [
  {
    name: 'Bananas',
    brand: null,
    category: 'produce',
    quantity: 6,
    unit: 'each',
    confidence: 0.94,
  },
  { name: 'Oat milk', brand: 'Oatly', category: 'dairy', quantity: 1, unit: 'l', confidence: 0.81 },
  {
    name: 'Roma tomatoes',
    brand: null,
    category: 'produce',
    quantity: 1.5,
    unit: 'lb',
    confidence: 0.72,
  },
  {
    name: 'Black beans',
    brand: null,
    category: 'canned',
    quantity: 3,
    unit: 'can',
    confidence: 0.66,
  },
  {
    name: 'Something in a jar',
    brand: null,
    category: 'other',
    quantity: 1,
    unit: 'jar',
    confidence: 0.31,
  },
]

const env = loadEnv({
  ...process.env,
  WEB_DIST: process.env.WEB_DIST ?? join(root, 'apps/web/dist'),
  NODE_ENV: 'production',
})

const { db } = createDb(env.DATABASE_URL)

const app = await buildApp({
  env,
  db,
  productLookup: nullProductLookup,
  vision: { available: true, identify: async () => CANDIDATES },
})

await app.listen({ host: '127.0.0.1', port: PORT })
console.info(`stub-vision server on http://127.0.0.1:${PORT} — ${CANDIDATES.length} canned items`)
