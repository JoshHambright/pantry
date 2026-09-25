/**
 * Import a recipe from a URL.
 *
 * Nearly every recipe site publishes schema.org JSON-LD, because Google's rich
 * results depend on it. That makes this deterministic, free and testable — no
 * model call, no screen-scraping heuristics that rot when a site restyles. When
 * a page has no structured data we say so plainly rather than guessing: the
 * recipe form already accepts pasted ingredient lines, and
 * `parseQuantity` handles "2 lbs chicken thighs" perfectly well.
 */

import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { parseQuantity, type ImportedIngredient, type ImportedRecipe } from '@pantry/shared'
import { badRequest, unavailable } from '../errors.js'

export type { ImportedIngredient, ImportedRecipe }

const MAX_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 3

/* ------------------------------------------------------------ url safety */

/**
 * This endpoint makes the server fetch a URL chosen by whoever is signed in,
 * and the server sits on a home network next to a router admin page and a
 * database. Blocking private address space is what keeps "import a recipe"
 * from also being "read anything on my LAN".
 */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address)

  if (version === 4) {
    const parts = address.split('.').map(Number)
    const [a, b] = [parts[0] ?? 0, parts[1] ?? 0]
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
    return false
  }

  if (version === 6) {
    const lower = address.toLowerCase()
    if (lower === '::1' || lower === '::') return true
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true // unique local
    if (lower.startsWith('fe80')) return true // link-local
    // ::ffff:10.0.0.1 and friends are IPv4 wearing a hat.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
    if (mapped?.[1]) return isPrivateAddress(mapped[1])
    return false
  }

  return false
}

export type Resolver = (hostname: string) => Promise<string[]>

const defaultResolver: Resolver = async (hostname) => {
  const results = await dnsLookup(hostname, { all: true })
  return results.map((entry) => entry.address)
}

export async function assertFetchable(raw: string, resolve: Resolver = defaultResolver) {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw badRequest('That does not look like a web address')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw badRequest('Only http and https addresses can be imported')
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw badRequest('That address is on this network, not the web')
  }

  // A hostname can resolve to a private address, so check what it points at
  // rather than only how it is spelled.
  const addresses = isIP(hostname) ? [hostname] : await resolve(hostname).catch(() => [])
  if (addresses.length === 0) throw badRequest('That address could not be looked up')
  if (addresses.some(isPrivateAddress)) {
    throw badRequest('That address is on this network, not the web')
  }

  return url
}

/* ------------------------------------------------------- json-ld parsing */

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

const asArray = (value: Json | undefined): Json[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value]

const isObject = (value: Json | undefined): value is Record<string, Json> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function hasType(node: Record<string, Json>, wanted: string): boolean {
  return asArray(node['@type']).some(
    (type) => typeof type === 'string' && type.toLowerCase() === wanted,
  )
}

/** JSON-LD nests recipes inside @graph, arrays, and occasionally both. */
function findRecipeNode(value: Json): Record<string, Json> | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findRecipeNode(entry)
      if (found) return found
    }
    return null
  }
  if (!isObject(value)) return null
  if (hasType(value, 'recipe')) return value
  if (value['@graph'] !== undefined) return findRecipeNode(value['@graph'])
  return null
}

export function extractJsonLdBlocks(html: string): Json[] {
  const blocks: Json[] = []
  const pattern = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi

  for (const match of html.matchAll(pattern)) {
    const body = (match[1] ?? '').trim()
    if (body === '') continue
    try {
      blocks.push(JSON.parse(body) as Json)
    } catch {
      // One malformed block on a page is normal; keep reading the others.
    }
  }
  return blocks
}

const decodeEntities = (text: string): string =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')

const stripTags = (text: string): string =>
  decodeEntities(text.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

/** `recipeYield` is "4", 4, "Serves 4", "4 servings", or an array of those. */
export function parseServings(value: Json | undefined): number {
  for (const entry of asArray(value)) {
    if (typeof entry === 'number' && Number.isFinite(entry) && entry > 0) {
      return Math.min(50, Math.round(entry))
    }
    if (typeof entry === 'string') {
      const match = /\d+/.exec(entry)
      const parsed = match ? Number.parseInt(match[0], 10) : Number.NaN
      if (Number.isFinite(parsed) && parsed > 0) return Math.min(50, parsed)
    }
  }
  return 4
}

/**
 * `recipeInstructions` is a string, an array of strings, an array of HowToStep,
 * or an array of HowToSection each wrapping its own steps. All four turn up.
 */
export function parseInstructions(value: Json | undefined): string | null {
  const steps: string[] = []

  const walk = (node: Json): void => {
    if (typeof node === 'string') {
      const text = stripTags(node)
      if (text) steps.push(text)
      return
    }
    if (Array.isArray(node)) {
      for (const entry of node) walk(entry)
      return
    }
    if (!isObject(node)) return

    if (node['itemListElement'] !== undefined) {
      walk(node['itemListElement'])
      return
    }
    const text = node['text'] ?? node['name']
    if (typeof text === 'string') walk(text)
  }

  walk(value ?? null)
  if (steps.length === 0) return null
  return steps.length === 1 ? (steps[0] ?? null) : steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
}

export function parseIngredients(value: Json | undefined): ImportedIngredient[] {
  const lines = asArray(value)
    .filter((entry): entry is string => typeof entry === 'string')
    .map(stripTags)
    .filter((line) => line !== '')

  return lines.map((raw) => {
    const parsed = parseQuantity(raw)
    return {
      // An empty remainder means the line was only a number; keep the original
      // rather than storing an ingredient with no name.
      name: parsed?.remainder?.trim() || raw,
      quantity: parsed?.quantity ?? 1,
      unit: parsed?.unit ?? 'each',
      raw,
    }
  })
}

export function parseRecipeFromHtml(html: string, sourceUrl: string): ImportedRecipe | null {
  for (const block of extractJsonLdBlocks(html)) {
    const node = findRecipeNode(block)
    if (!node) continue

    const name = typeof node['name'] === 'string' ? stripTags(node['name']) : ''
    if (name === '') continue

    return {
      name: name.slice(0, 160),
      servings: parseServings(node['recipeYield']),
      instructions: parseInstructions(node['recipeInstructions']),
      sourceUrl,
      ingredients: parseIngredients(node['recipeIngredient'] ?? node['ingredients']).slice(0, 100),
    }
  }
  return null
}

/* ------------------------------------------------------------- the fetch */

export interface ImportOptions {
  fetchImpl?: typeof fetch
  resolve?: Resolver
  timeoutMs?: number
  userAgent?: string
}

/** Reads at most MAX_BYTES, so a hostile or broken page cannot exhaust memory. */
async function readCapped(response: Response): Promise<string> {
  const body = response.body
  if (!body) return ''

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let html = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BYTES) {
      await reader.cancel()
      break
    }
    html += decoder.decode(value, { stream: true })
  }
  return html
}

export async function importRecipeFromUrl(
  rawUrl: string,
  options: ImportOptions = {},
): Promise<ImportedRecipe> {
  const doFetch = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 8000

  let url = await assertFetchable(rawUrl, options.resolve)

  // Redirects are followed by hand so every hop is checked — otherwise a
  // public URL could bounce the server onto the LAN.
  for (let hop = 0; ; hop += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    let response: Response
    try {
      response = await doFetch(url, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': options.userAgent ?? 'Pantry/0.1 (self-hosted household inventory)',
        },
      })
    } catch {
      throw unavailable('That page could not be reached')
    } finally {
      clearTimeout(timer)
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw unavailable('That page could not be reached')
      if (hop >= MAX_REDIRECTS) throw unavailable('That page redirected too many times')
      url = await assertFetchable(new URL(location, url).toString(), options.resolve)
      continue
    }

    if (!response.ok) {
      throw unavailable(`That page returned ${response.status}`)
    }

    const recipe = parseRecipeFromHtml(await readCapped(response), url.toString())
    if (!recipe) {
      throw badRequest(
        'That page has no recipe data we can read. Paste the ingredients in instead — ' +
          'one per line, written the way you would say them.',
      )
    }
    return recipe
  }
}
