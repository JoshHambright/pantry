import { describe, expect, it } from 'vitest'
import {
  assertFetchable,
  extractJsonLdBlocks,
  importRecipeFromUrl,
  isPrivateAddress,
  parseIngredients,
  parseInstructions,
  parseRecipeFromHtml,
  parseServings,
} from './recipe-import.js'

const publicResolver = async () => ['93.184.216.34']

const page = (jsonLd: unknown, extra = '') => `<!doctype html><html><head>
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>${extra}
</head><body>ignored</body></html>`

describe('isPrivateAddress', () => {
  it.each([
    '10.0.0.1',
    '127.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1', // carrier-grade NAT, which is what Tailscale uses
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:192.168.0.1',
  ])('treats %s as private', (address) => {
    expect(isPrivateAddress(address)).toBe(true)
  })

  it.each(['8.8.8.8', '93.184.216.34', '172.32.0.1', '172.15.0.1', '2606:4700::1111'])(
    'treats %s as public',
    (address) => {
      expect(isPrivateAddress(address)).toBe(false)
    },
  )
})

describe('assertFetchable', () => {
  it('accepts an ordinary https URL', async () => {
    const url = await assertFetchable('https://example.com/recipe', publicResolver)
    expect(url.hostname).toBe('example.com')
  })

  it.each(['file:///etc/passwd', 'ftp://example.com', 'gopher://example.com'])(
    'refuses %s',
    async (raw) => {
      await expect(assertFetchable(raw, publicResolver)).rejects.toThrow(/http and https/)
    },
  )

  it('refuses nonsense', async () => {
    await expect(assertFetchable('not a url', publicResolver)).rejects.toThrow(/web address/)
  })

  it.each(['http://localhost/x', 'http://nas.local/x', 'http://db.internal/x'])(
    'refuses %s by name',
    async (raw) => {
      await expect(assertFetchable(raw, publicResolver)).rejects.toThrow(/on this network/)
    },
  )

  it('refuses a literal private address', async () => {
    await expect(assertFetchable('http://192.168.1.1/admin', publicResolver)).rejects.toThrow(
      /on this network/,
    )
  })

  it('refuses a public name that resolves onto the LAN', async () => {
    // The whole point of resolving: the spelling is innocent.
    const evil = async () => ['10.1.2.3']
    await expect(assertFetchable('https://recipes.example.com/x', evil)).rejects.toThrow(
      /on this network/,
    )
  })

  it('refuses when any resolved address is private', async () => {
    const mixed = async () => ['93.184.216.34', '127.0.0.1']
    await expect(assertFetchable('https://example.com/x', mixed)).rejects.toThrow(/on this network/)
  })

  it('refuses a name that does not resolve', async () => {
    await expect(assertFetchable('https://nope.example/x', async () => [])).rejects.toThrow(
      /could not be looked up/,
    )
  })
})

describe('parseServings', () => {
  it.each([
    [4, 4],
    ['4', 4],
    ['4 servings', 4],
    ['Serves 6', 6],
    [['8'], 8],
    ['makes 12 cookies', 12],
  ])('reads %j as %i', (input, expected) => {
    expect(parseServings(input as never)).toBe(expected)
  })

  it('falls back to 4 when there is no number', () => {
    expect(parseServings('a family meal')).toBe(4)
    expect(parseServings(undefined)).toBe(4)
  })

  it('caps at something sane', () => {
    expect(parseServings('900 servings')).toBe(50)
  })
})

describe('parseInstructions', () => {
  it('reads a plain string', () => {
    expect(parseInstructions('Mix and bake.')).toBe('Mix and bake.')
  })

  it('numbers an array of steps', () => {
    expect(parseInstructions(['Chop.', 'Fry.'])).toBe('1. Chop.\n2. Fry.')
  })

  it('reads HowToStep objects', () => {
    const steps = [
      { '@type': 'HowToStep', text: 'Preheat the oven.' },
      { '@type': 'HowToStep', text: 'Season the chicken.' },
    ]
    expect(parseInstructions(steps as never)).toBe('1. Preheat the oven.\n2. Season the chicken.')
  })

  it('flattens HowToSection', () => {
    const sections = [
      {
        '@type': 'HowToSection',
        name: 'For the sauce',
        itemListElement: [{ '@type': 'HowToStep', text: 'Reduce the stock.' }],
      },
      {
        '@type': 'HowToSection',
        itemListElement: [{ '@type': 'HowToStep', text: 'Serve.' }],
      },
    ]
    expect(parseInstructions(sections as never)).toBe('1. Reduce the stock.\n2. Serve.')
  })

  it('strips markup and decodes entities', () => {
    expect(parseInstructions('<p>Salt &amp; pepper</p>')).toBe('Salt & pepper')
  })

  it('returns null when there is nothing', () => {
    expect(parseInstructions(undefined)).toBeNull()
    expect(parseInstructions([])).toBeNull()
  })
})

describe('parseIngredients', () => {
  it('splits an amount off each line', () => {
    const parsed = parseIngredients(['2 lbs chicken thighs', '1 1/2 cups rice', '3 bananas'])
    expect(parsed).toEqual([
      { name: 'chicken thighs', quantity: 2, unit: 'lb', raw: '2 lbs chicken thighs' },
      { name: 'rice', quantity: 1.5, unit: 'cup', raw: '1 1/2 cups rice' },
      { name: 'bananas', quantity: 3, unit: 'each', raw: '3 bananas' },
    ])
  })

  it('keeps the original line so a human can check it', () => {
    expect(parseIngredients(['a pinch of salt'])[0]).toMatchObject({
      raw: 'a pinch of salt',
      name: 'a pinch of salt',
    })
  })

  it('does not produce a nameless ingredient from a bare number', () => {
    expect(parseIngredients(['2'])[0]).toMatchObject({ name: '2' })
  })

  it('ignores non-strings and blanks', () => {
    expect(parseIngredients(['', '  ', 4, null] as never)).toEqual([])
  })
})

describe('extractJsonLdBlocks', () => {
  it('finds a block', () => {
    expect(extractJsonLdBlocks(page({ a: 1 }))).toEqual([{ a: 1 }])
  })

  it('skips a malformed block but keeps the rest', () => {
    const html = `<script type="application/ld+json">{oops</script>
      <script type="application/ld+json">{"ok":true}</script>`
    expect(extractJsonLdBlocks(html)).toEqual([{ ok: true }])
  })

  it('ignores other script tags', () => {
    expect(extractJsonLdBlocks('<script>var recipe = 1</script>')).toEqual([])
  })
})

describe('parseRecipeFromHtml', () => {
  const recipe = {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: 'Chicken tacos',
    recipeYield: '4 servings',
    recipeIngredient: ['1.5 lb chicken thighs', '1 pack tortillas'],
    recipeInstructions: [{ '@type': 'HowToStep', text: 'Sear the chicken.' }],
  }

  it('reads a straightforward page', () => {
    const parsed = parseRecipeFromHtml(page(recipe), 'https://example.com/tacos')
    expect(parsed).toMatchObject({
      name: 'Chicken tacos',
      servings: 4,
      sourceUrl: 'https://example.com/tacos',
    })
    expect(parsed?.ingredients).toHaveLength(2)
    expect(parsed?.ingredients[0]).toMatchObject({
      name: 'chicken thighs',
      quantity: 1.5,
      unit: 'lb',
    })
  })

  it('finds a recipe inside @graph', () => {
    const html = page({ '@graph': [{ '@type': 'WebSite' }, recipe] })
    expect(parseRecipeFromHtml(html, 'https://x.test')?.name).toBe('Chicken tacos')
  })

  it('finds a recipe inside a top-level array', () => {
    const html = page([{ '@type': 'Organization' }, recipe])
    expect(parseRecipeFromHtml(html, 'https://x.test')?.name).toBe('Chicken tacos')
  })

  it('accepts an array @type', () => {
    const html = page({ ...recipe, '@type': ['Recipe', 'NewsArticle'] })
    expect(parseRecipeFromHtml(html, 'https://x.test')?.name).toBe('Chicken tacos')
  })

  it('returns null for a page with no recipe', () => {
    expect(parseRecipeFromHtml(page({ '@type': 'Article' }), 'https://x.test')).toBeNull()
    expect(parseRecipeFromHtml('<html></html>', 'https://x.test')).toBeNull()
  })

  it('skips a recipe with no name rather than importing a blank', () => {
    const html = page({ '@type': 'Recipe', recipeIngredient: ['salt'] })
    expect(parseRecipeFromHtml(html, 'https://x.test')).toBeNull()
  })
})

describe('importRecipeFromUrl', () => {
  const recipe = {
    '@type': 'Recipe',
    name: 'Rice bowl',
    recipeYield: 2,
    recipeIngredient: ['200 g rice'],
  }

  const htmlResponse = (html: string, status = 200, headers: Record<string, string> = {}) =>
    new Response(html, { status, headers })

  it('fetches and parses', async () => {
    const result = await importRecipeFromUrl('https://example.com/rice', {
      fetchImpl: async () => htmlResponse(page(recipe)),
      resolve: publicResolver,
    })
    expect(result).toMatchObject({ name: 'Rice bowl', servings: 2 })
  })

  it('follows a redirect and re-checks the destination', async () => {
    const seen: string[] = []
    const result = await importRecipeFromUrl('https://example.com/old', {
      resolve: publicResolver,
      fetchImpl: async (input) => {
        const url = String(input)
        seen.push(url)
        return url.endsWith('/old')
          ? htmlResponse('', 301, { location: 'https://example.com/new' })
          : htmlResponse(page(recipe))
      },
    })
    expect(seen).toEqual(['https://example.com/old', 'https://example.com/new'])
    expect(result.sourceUrl).toBe('https://example.com/new')
  })

  it('refuses a redirect that points at the LAN', async () => {
    // The guard that matters: the first URL is fine, the second is not.
    await expect(
      importRecipeFromUrl('https://example.com/bounce', {
        resolve: async (hostname) =>
          hostname === 'example.com' ? ['93.184.216.34'] : ['10.0.0.5'],
        fetchImpl: async (input) =>
          String(input).includes('bounce')
            ? htmlResponse('', 302, { location: 'http://internal.example.org/admin' })
            : htmlResponse(page(recipe)),
      }),
    ).rejects.toThrow(/on this network/)
  })

  it('gives up on a redirect loop', async () => {
    await expect(
      importRecipeFromUrl('https://example.com/a', {
        resolve: publicResolver,
        fetchImpl: async () => htmlResponse('', 302, { location: 'https://example.com/a' }),
      }),
    ).rejects.toThrow(/redirected too many times/)
  })

  it('reports an unreachable page rather than throwing raw', async () => {
    await expect(
      importRecipeFromUrl('https://example.com/x', {
        resolve: publicResolver,
        fetchImpl: async () => {
          throw new Error('ECONNREFUSED')
        },
      }),
    ).rejects.toThrow(/could not be reached/)
  })

  it('reports an error status', async () => {
    await expect(
      importRecipeFromUrl('https://example.com/x', {
        resolve: publicResolver,
        fetchImpl: async () => htmlResponse('nope', 404),
      }),
    ).rejects.toThrow(/returned 404/)
  })

  it('tells you what to do when a page has no recipe data', async () => {
    await expect(
      importRecipeFromUrl('https://example.com/blog', {
        resolve: publicResolver,
        fetchImpl: async () => htmlResponse('<html><body>just prose</body></html>'),
      }),
    ).rejects.toThrow(/Paste the ingredients in instead/)
  })
})
