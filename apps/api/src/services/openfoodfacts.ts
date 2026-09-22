/**
 * Barcode lookup against Open Food Facts.
 *
 * Open Food Facts is free, needs no key, and covers most packaged groceries
 * sold in the US. It is also community-maintained, so fields are frequently
 * missing or odd — every mapping below treats absence as normal.
 */

import { isCategory, normaliseUnit, type Category, type UnitCode } from '@pantry/shared'

export interface ProductLookupResult {
  upc: string
  name: string
  brand: string | null
  category: Category
  imageUrl: string | null
  /** Net contents from the label, when it parses into a unit we understand. */
  quantity: number | null
  unit: UnitCode | null
}

export interface ProductLookup {
  byBarcode(upc: string): Promise<ProductLookupResult | null>
}

interface OffProduct {
  product_name?: string
  product_name_en?: string
  generic_name?: string
  brands?: string
  categories_tags?: string[]
  image_front_url?: string
  image_url?: string
  quantity?: string
  product_quantity?: string
  product_quantity_unit?: string
}

interface OffResponse {
  status?: number
  product?: OffProduct
}

/**
 * Open Food Facts category tags are a deep taxonomy ("en:semi-skimmed-milks").
 * We only need the coarse bucket, so match on substrings, most specific first.
 */
const CATEGORY_HINTS: ReadonlyArray<readonly [string, Category]> = [
  ['frozen', 'frozen'],
  ['ice-cream', 'frozen'],
  ['canned', 'canned'],
  ['tinned', 'canned'],
  ['seafood', 'seafood'],
  ['fishes', 'seafood'],
  ['fish', 'seafood'],
  ['shellfish', 'seafood'],
  ['poultry', 'meat'],
  ['meat', 'meat'],
  ['charcuterie', 'meat'],
  ['dairy', 'dairy'],
  ['milk', 'dairy'],
  ['cheese', 'dairy'],
  ['yogurt', 'dairy'],
  ['egg', 'dairy'],
  ['bread', 'bakery'],
  ['baker', 'bakery'],
  ['pastr', 'bakery'],
  ['vegetable', 'produce'],
  ['fruit', 'produce'],
  ['fresh-food', 'produce'],
  ['beverage', 'beverages'],
  ['drink', 'beverages'],
  ['water', 'beverages'],
  ['juice', 'beverages'],
  ['coffee', 'beverages'],
  ['tea', 'beverages'],
  ['snack', 'snacks'],
  ['biscuit', 'snacks'],
  ['candy', 'snacks'],
  ['chocolate', 'snacks'],
  ['chip', 'snacks'],
  ['sauce', 'condiments'],
  ['condiment', 'condiments'],
  ['dressing', 'condiments'],
  ['spice', 'spices'],
  ['herb', 'spices'],
  ['seasoning', 'spices'],
  ['baking', 'baking'],
  ['flour', 'baking'],
  ['sugar', 'baking'],
  ['pasta', 'pantry'],
  ['rice', 'pantry'],
  ['cereal', 'pantry'],
  ['grocer', 'pantry'],
]

export function categoryFromTags(tags: readonly string[] | undefined): Category {
  if (!tags?.length) return 'other'
  const haystack = tags.join(' ').toLowerCase()
  for (const [needle, category] of CATEGORY_HINTS) {
    if (haystack.includes(needle)) return category
  }
  // A plain "en:milk"-style tag may already be one of our own names.
  for (const tag of tags) {
    const bare = tag.replace(/^[a-z]{2}:/, '')
    if (isCategory(bare)) return bare
  }
  return 'other'
}

/** "1 L", "500 g", "12 x 330 ml" — take the first amount we can make sense of. */
export function parseNetContents(
  raw: string | undefined,
): { quantity: number; unit: UnitCode } | null {
  if (!raw) return null
  const match = /(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)/.exec(raw)
  if (!match) return null
  const quantity = Number.parseFloat((match[1] ?? '').replace(',', '.'))
  const unit = normaliseUnit(match[2] ?? '')
  if (!Number.isFinite(quantity) || quantity <= 0 || !unit) return null
  return { quantity, unit }
}

export function mapOffProduct(upc: string, product: OffProduct): ProductLookupResult | null {
  const name = (
    product.product_name_en ??
    product.product_name ??
    product.generic_name ??
    ''
  ).trim()
  if (name === '') return null

  const brandRaw = (product.brands ?? '').split(',')[0]?.trim()
  const netFromNumeric =
    product.product_quantity && product.product_quantity_unit
      ? parseNetContents(`${product.product_quantity} ${product.product_quantity_unit}`)
      : null
  const net = netFromNumeric ?? parseNetContents(product.quantity)

  return {
    upc,
    name,
    brand: brandRaw ? brandRaw : null,
    category: categoryFromTags(product.categories_tags),
    imageUrl: product.image_front_url ?? product.image_url ?? null,
    quantity: net?.quantity ?? null,
    unit: net?.unit ?? null,
  }
}

export interface OffOptions {
  baseUrl: string
  userAgent: string
  timeoutMs: number
  fetchImpl?: typeof fetch
}

export function createOpenFoodFactsLookup(options: OffOptions): ProductLookup {
  const doFetch = options.fetchImpl ?? fetch

  return {
    async byBarcode(upc) {
      const url = `${options.baseUrl}/api/v2/product/${encodeURIComponent(upc)}.json`
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), options.timeoutMs)

      try {
        const response = await doFetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': options.userAgent,
            Accept: 'application/json',
          },
        })
        // A missing barcode is a 404 here, which is an answer, not a failure.
        if (response.status === 404) return null
        if (!response.ok) return null

        const body = (await response.json()) as OffResponse
        if (body.status === 0 || !body.product) return null
        return mapOffProduct(upc, body.product)
      } catch {
        // Offline, slow, or rate-limited: the caller falls back to manual entry.
        return null
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

/** Always misses. Used in tests and when a deployment wants no outbound calls. */
export const nullProductLookup: ProductLookup = {
  byBarcode: async () => null,
}
