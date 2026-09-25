/**
 * Prove the installed app still works with the network cut.
 *
 * A manifest makes the app *installable*; only a service worker makes it
 * *usable* offline. Before this existed, adding Pantry to a home screen and
 * opening it in a basement gave a white screen — the one place a chest-freezer
 * inventory is most wanted.
 *
 *   pnpm build && <serve the API with WEB_DIST set>
 *   node scripts/offline-check.mjs --base http://127.0.0.1:8099
 *
 * Exits non-zero if the shell does not render offline.
 */

import { mkdirSync } from 'node:fs'

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  console.error('playwright is not installed.\n\n  pnpm add -Dw playwright\n')
  process.exit(1)
}

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const BASE = arg('base', 'http://127.0.0.1:8099')
const OUT = '.walkthrough'
mkdirSync(OUT, { recursive: true })

const executablePath =
  process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const browser = await chromium.launch(process.env.USE_BUNDLED_CHROMIUM ? {} : { executablePath })
const context = await browser.newContext({ viewport: { width: 414, height: 896 } })
const page = await context.newPage()

const fail = (message) => {
  console.error(`FAIL: ${message}`)
  process.exitCode = 1
}

console.info(`1. loading ${BASE} and waiting for the service worker`)
await page.goto(BASE, { waitUntil: 'networkidle' })

const activated = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return 'unsupported'
  const registration = await navigator.serviceWorker.ready
  return registration.active ? 'active' : 'registered-but-inactive'
})
console.info(`   service worker: ${activated}`)
if (activated !== 'active') fail('the service worker never activated')

// The precache is populated by the install event, which races the first paint.
await page.waitForTimeout(2500)

const cached = await page.evaluate(async () => {
  const names = await caches.keys()
  const counts = {}
  for (const name of names) counts[name] = (await (await caches.open(name)).keys()).length
  return counts
})
console.info(`   caches: ${JSON.stringify(cached)}`)
if (Object.values(cached).reduce((a, b) => a + b, 0) === 0) fail('nothing was precached')

console.info('2. signing in, so the interesting case is covered')
// The sign-in picker rendering offline is the easy half. What matters is the
// signed-in app showing yesterday's inventory and saying so, rather than
// looking current.
const MEMBER = arg('member', 'Josh')
const PIN = arg('pin', '1234')
await page.getByRole('button', { name: new RegExp(MEMBER) }).click()
for (const digit of PIN.split('')) {
  await page.getByRole('button', { name: digit, exact: true }).click()
}
await page.waitForSelector('.tabbar', { timeout: 15000 })
await page
  .locator('.tabbar')
  .getByRole('button', { name: /Pantry/ })
  .click()
await page.waitForSelector('.list .item', { timeout: 15000 })
const onlineRows = await page.locator('.list .item .item__title').allTextContents()
console.info(`   pantry shows ${onlineRows.length} products online`)

console.info('3. cutting the network')
await context.setOffline(true)

console.info('4. reloading offline')
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1800)

const renderedOffline = await page.evaluate(
  () => document.querySelector('#root')?.children.length > 0,
)
console.info(`   app shell rendered: ${renderedOffline}`)
if (!renderedOffline) fail('the app did not render with the network cut')

// Stale data is fine; stale data that looks live is not.
const warned = await page.evaluate(() =>
  [...document.querySelectorAll('.banner')].some((n) => /offline/i.test(n.textContent ?? '')),
)
console.info(`   offline banner shown: ${warned}`)
if (!warned) fail('the app showed cached data without saying it was offline')

await page
  .locator('.tabbar')
  .getByRole('button', { name: /Pantry/ })
  .click()
await page.waitForTimeout(1200)
const offlineRows = await page.locator('.list .item .item__title').allTextContents()
console.info(`   pantry shows ${offlineRows.length} products offline (from cache)`)
if (offlineRows.length === 0) fail('the pantry was empty offline — the API cache did not serve')

await page.screenshot({ path: `${OUT}/offline-shell.png` })
console.info(`   ${OUT}/offline-shell.png`)

console.info('5. confirming a write is refused rather than silently lost')
const writeResult = await page.evaluate(async () => {
  try {
    const response = await fetch('/api/shopping', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'should not be saved' }),
    })
    return `unexpectedly returned ${response.status}`
  } catch {
    return 'rejected'
  }
})
console.info(`   POST while offline: ${writeResult}`)
if (writeResult !== 'rejected') fail('a write appeared to succeed while offline')

console.info('6. back online')
await context.setOffline(false)
await page.reload({ waitUntil: 'networkidle' })
const backOnline = await page.evaluate(() => document.querySelector('#root')?.children.length > 0)
if (!backOnline) fail('the app did not recover when the network returned')

await browser.close()
console.info(process.exitCode ? '\nOffline check FAILED.' : '\nOffline check passed.')
