/**
 * Drive the web app through every screen in a real browser.
 *
 * This is not a test suite — the assertions live in Vitest. It is the thing
 * that catches what tests cannot: a screen that renders but reads wrong, a
 * sentence that contradicts what is next to it, a layout that breaks at phone
 * width. Two wording bugs shipped past a green test suite and were caught here.
 *
 *   pnpm build
 *   DATABASE_URL=... node scripts/stub-vision-server.mjs &
 *   node scripts/ui-walkthrough.mjs --base http://127.0.0.1:8098
 *
 * Screenshots land in .walkthrough/ (gitignored). Pass --scan to also drive the
 * photo-scan flow, which needs the stub server above rather than the real API.
 *
 * Assumes the demo seed (`pnpm db:seed`): a member called Josh with PIN 1234.
 */

import { mkdirSync, writeFileSync } from 'node:fs'

// Playwright is deliberately not a dependency of this workspace: it is a large
// install that CI never needs, and this script is the only thing that uses it.
let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  console.error(
    'playwright is not installed.\n\n' +
      '  pnpm add -Dw playwright\n\n' +
      'In the Claude Code cloud image the browser is already present, so do NOT\n' +
      'run `npx playwright install` — set CHROME_PATH instead if the default is wrong.',
  )
  process.exit(1)
}

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const BASE = arg('base', 'http://127.0.0.1:8080')
const MEMBER = arg('member', 'Josh')
const PIN = arg('pin', '1234')
const WITH_SCAN = process.argv.includes('--scan')
const OUT = '.walkthrough'

mkdirSync(OUT, { recursive: true })

// Playwright's bundled browser may not match what is installed. In the Claude
// Code cloud image the browsers live here and must not be re-downloaded.
const executablePath =
  process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const browser = await chromium.launch(process.env.USE_BUNDLED_CHROMIUM ? {} : { executablePath })
const page = await browser.newPage({
  viewport: { width: 414, height: 896 },
  deviceScaleFactor: 2,
})

const problems = []
page.on('pageerror', (error) => problems.push(`page error: ${error.message}`))
page.on('console', (message) => {
  if (message.type() !== 'error') return
  // The session probe before sign-in is a 401 by design.
  if (message.text().includes('401')) return
  problems.push(`console: ${message.text()}`)
})

let step = 0
const shot = async (name) => {
  step += 1
  await page.waitForTimeout(400)
  const file = `${OUT}/${String(step).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path: file })
  console.info(`  ${file}`)
}

/** Tab labels also appear as section links, so scope them to the tab bar. */
const tab = (name) => page.locator('.tabbar').getByRole('button', { name })

console.info(`driving ${BASE}`)

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: new RegExp(MEMBER) }).click()
await shot('pin')

for (const digit of PIN.split('')) {
  await page.getByRole('button', { name: digit, exact: true }).click()
}
await page.waitForSelector('.tabbar', { timeout: 15000 })
await shot('dashboard')

await tab(/Pantry/).click()
await page.waitForSelector('.list .item', { timeout: 15000 })
await shot('pantry')

await page.locator('.list .item').first().click()
await page.waitForSelector('.sheet', { timeout: 15000 })
await shot('product')
await page.getByRole('button', { name: 'Close' }).click()

await tab(/List/).click()
await page.waitForTimeout(600)
await shot('shopping')

await tab(/Meals/).click()
await page.waitForTimeout(700)
await shot('meals-week')

await page.getByRole('button', { name: 'Recipes' }).click()
await page.waitForTimeout(800)
await shot('recipes')

if ((await page.locator('.list .item').count()) > 0) {
  await page.locator('.list .item').first().click()
  await page.waitForSelector('.sheet', { timeout: 15000 })
  await shot('recipe-detail')
  await page.getByRole('button', { name: 'Close' }).click()
}

await tab(/Scan/).click()
await page.waitForTimeout(600)
await shot('scan-barcode')

if (WITH_SCAN) {
  console.info('photo scan (needs the stub-vision server)')
  const photo = `${OUT}/photo.jpg`
  writeFileSync(
    photo,
    Buffer.from(
      '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
      'base64',
    ),
  )
  await page.getByRole('button', { name: 'Photo' }).click()
  await page.waitForTimeout(400)
  await page.setInputFiles('input[type=file]', photo)
  await page.waitForSelector('.sheet', { timeout: 30000 })
  await shot('scan-review')

  const accepted = await page.locator('.sheet [role=checkbox][aria-checked=true]').count()
  const held = await page.locator('.sheet [role=checkbox][aria-checked=false]').count()
  console.info(`  ${accepted} pre-accepted, ${held} held back as low confidence`)
  await page.getByRole('button', { name: 'Close' }).click()
}

await tab(/Home/).click()
await page.waitForTimeout(600)
await page.getByRole('button', { name: /Answer|Ask for something/ }).click()
await page.waitForTimeout(700)
await shot('requests')

await page.getByRole('button', { name: /Signed in as/ }).click()
await page.waitForTimeout(700)
await shot('settings')

// Dark mode is a whole second theme; it is worth one look every time.
await page.emulateMedia({ colorScheme: 'dark' })
await tab(/Home/).click()
await page.waitForTimeout(800)
await shot('dashboard-dark')

await browser.close()

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):\n${problems.join('\n')}`)
  process.exit(1)
}
console.info('\nNo page or console errors.')
