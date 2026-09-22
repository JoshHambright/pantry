import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  addMember,
  bootstrapHousehold,
  createHarness,
  firstLocationId,
  hasDatabase,
  locationIdNamed,
  resetDatabase,
  type Actor,
  type Harness,
} from './test-support.js'
import type { StockRow } from '@pantry/shared'

const describeDb = hasDatabase ? describe : describe.skip

describeDb('pantry api', () => {
  let harness: Harness

  beforeAll(async () => {
    harness = await createHarness()
  })

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await resetDatabase(harness.db)
  })

  const get = (url: string, actor: Actor) =>
    harness.app.inject({ method: 'GET', url, headers: { cookie: actor.cookie } })

  const post = (url: string, actor: Actor, payload?: unknown) =>
    harness.app.inject({
      method: 'POST',
      url,
      headers: { cookie: actor.cookie },
      ...(payload === undefined ? {} : { payload }),
    })

  const patch = (url: string, actor: Actor, payload: unknown) =>
    harness.app.inject({ method: 'PATCH', url, headers: { cookie: actor.cookie }, payload })

  async function makeProduct(
    actor: Actor,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const response = await post('/api/products', actor, {
      name: 'Rice',
      category: 'pantry',
      defaultUnit: 'g',
      ...overrides,
    })
    expect(response.statusCode).toBe(201)
    return response.json<{ id: string }>().id
  }

  async function addStock(
    actor: Actor,
    productId: string,
    locationId: string,
    body: Record<string, unknown>,
  ) {
    return post('/api/inventory', actor, { productId, locationId, ...body })
  }

  async function inventory(actor: Actor): Promise<StockRow[]> {
    const response = await get('/api/inventory', actor)
    expect(response.statusCode).toBe(200)
    return response.json<{ items: StockRow[] }>().items
  }

  describe('setup and sign-in', () => {
    it('creates a household, starter locations and the first adult', async () => {
      const josh = await bootstrapHousehold(harness.app)

      const session = await get('/api/auth/session', josh)
      expect(session.statusCode).toBe(200)
      expect(session.json<{ household: { name: string } }>().household.name).toBe('Test House')

      const locations = await get('/api/locations', josh)
      expect(locations.json<{ locations: unknown[] }>().locations).toHaveLength(3)
    })

    it('refuses a second bootstrap', async () => {
      await bootstrapHousehold(harness.app)
      const again = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/bootstrap',
        payload: { householdName: 'Other', memberName: 'Someone', pin: '9999' },
      })
      expect(again.statusCode).toBe(409)
    })

    it('rejects a wrong PIN without saying which part was wrong', async () => {
      const josh = await bootstrapHousehold(harness.app)
      const response = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { memberId: josh.id, pin: '0000' },
      })
      expect(response.statusCode).toBe(401)
      expect(response.json<{ message: string }>().message).toBe('That PIN did not work')
    })

    it('locks the account after repeated wrong PINs', async () => {
      const josh = await bootstrapHousehold(harness.app)
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await harness.app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { memberId: josh.id, pin: '0000' },
        })
      }
      // Even the correct PIN is refused while the lockout holds.
      const correct = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { memberId: josh.id, pin: '1234' },
      })
      expect(correct.statusCode).toBe(401)
      expect(correct.json<{ message: string }>().message).toMatch(/Too many tries/)
    })

    it('never exposes a PIN hash through the member picker', async () => {
      await bootstrapHousehold(harness.app)
      const response = await harness.app.inject({ method: 'GET', url: '/api/auth/members' })
      expect(response.body).not.toMatch(/scrypt/)
      expect(response.body).not.toMatch(/pinHash/)
    })

    it('turns away anyone without a session', async () => {
      const response = await harness.app.inject({ method: 'GET', url: '/api/inventory' })
      expect(response.statusCode).toBe(401)
    })
  })

  describe('inventory', () => {
    it('sums lots that share a unit group', async () => {
      const josh = await bootstrapHousehold(harness.app)
      const locationId = await firstLocationId(harness.app, josh)
      const productId = await makeProduct(josh)

      await addStock(josh, productId, locationId, { quantity: 500, unit: 'g' })
      await addStock(josh, productId, locationId, { quantity: 1, unit: 'kg' })

      const [row] = await inventory(josh)
      expect(row?.totals).toHaveLength(1)
      expect(row?.totals[0]).toMatchObject({ unit: 'kg', quantity: 1.5 })
    })

    it('keeps incompatible holdings apart instead of inventing a total', async () => {
      const josh = await bootstrapHousehold(harness.app)
      const locationId = await firstLocationId(harness.app, josh)
      const productId = await makeProduct(josh, { name: 'Tomatoes', defaultUnit: 'can' })

      await addStock(josh, productId, locationId, { quantity: 3, unit: 'can' })
      await addStock(josh, productId, locationId, { quantity: 400, unit: 'g' })

      const [row] = await inventory(josh)
      expect(row?.totals).toHaveLength(2)
    })

    it('consumes the soonest-expiring lot first', async () => {
      const josh = await bootstrapHousehold(harness.app)
      const locationId = await firstLocationId(harness.app, josh)
      const productId = await makeProduct(josh, { name: 'Milk', defaultUnit: 'l' })

      await addStock(josh, productId, locationId, {
        quantity: 2,
        unit: 'l',
        expiresAt: '2030-01-01',
      })
      await addStock(josh, productId, locationId, {
        quantity: 1,
        unit: 'l',
        expiresAt: '2026-01-01',
      })

      const consumed = await post('/api/inventory/consume', josh, {
        productId,
        quantity: 1,
        unit: 'l',
      })
      expect(consumed.statusCode).toBe(200)
      expect(consumed.json<{ shortfall: number }>().shortfall).toBe(0)

      const [row] = await inventory(josh)
      // The older lot is gone entirely; the 2030 one is untouched.
      expect(row?.lots).toHaveLength(1)
      expect(row?.lots[0]?.expiresAt).toBe('2030-01-01')
    })

    it('reports a shortfall rather than going negative', async () => {
      const josh = await bootstrapHousehold(harness.app)
      const locationId = await firstLocationId(harness.app, josh)
      const productId = await makeProduct(josh)

      await addStock(josh, productId, locationId, { quantity: 100, unit: 'g' })
      const consumed = await post('/api/inventory/consume', josh, {
        productId,
        quantity: 250,
        unit: 'g',
      })

      expect(consumed.json<{ shortfall: number; consumed: number }>()).toMatchObject({
        consumed: 100,
        shortfall: 150,
      })
      expect(await inventory(josh)).toHaveLength(0)
    })

    it('refuses to change a lot’s unit without a new amount', async () => {
      const josh = await bootstrapHousehold(harness.app)
      const locationId = await firstLocationId(harness.app, josh)
      const productId = await makeProduct(josh)

      const added = await addStock(josh, productId, locationId, { quantity: 2, unit: 'lb' })
      const lotId = added.json<{ id: string }>().id

      const response = await patch(`/api/inventory/lots/${lotId}`, josh, { unit: 'kg' })
      expect(response.statusCode).toBe(400)
    })

    it('flags what has expired and what is about to', async () => {
      const josh = await bootstrapHousehold(harness.app)
      const locationId = await firstLocationId(harness.app, josh)
      const yoghurt = await makeProduct(josh, { name: 'Yoghurt', defaultUnit: 'each' })

      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
      await addStock(josh, yoghurt, locationId, { quantity: 1, unit: 'each', expiresAt: yesterday })

      const dashboard = await get('/api/dashboard', josh)
      expect(dashboard.json<{ expired: unknown[] }>().expired).toHaveLength(1)
    })

    it('records who added what', async () => {
      const josh = await bootstrapHousehold(harness.app)
      const locationId = await firstLocationId(harness.app, josh)
      const productId = await makeProduct(josh)
      await addStock(josh, productId, locationId, { quantity: 1, unit: 'kg' })

      const events = await get('/api/inventory/events', josh)
      const body = events.json<{ events: { kind: string; memberName: string }[] }>()
      expect(body.events[0]).toMatchObject({ kind: 'added', memberName: 'Josh' })
    })
  })

  describe('roles', () => {
    let josh: Actor
    let kid: Actor

    beforeEach(async () => {
      josh = await bootstrapHousehold(harness.app)
      kid = await addMember(harness.app, josh, { name: 'Sam', role: 'child', pin: '4321' })
    })

    it('stops a child changing the inventory', async () => {
      const locationId = await firstLocationId(harness.app, josh)
      const productId = await makeProduct(josh)

      const response = await addStock(kid, productId, locationId, { quantity: 1, unit: 'kg' })
      expect(response.statusCode).toBe(403)
    })

    it('lets a child see what is in the house', async () => {
      const response = await get('/api/inventory', kid)
      expect(response.statusCode).toBe(200)
    })

    it('lets a child ask for a meal', async () => {
      const response = await post('/api/requests', kid, { kind: 'meal', text: 'Tacos please' })
      expect(response.statusCode).toBe(201)
      expect(response.json<{ requestedByName: string }>().requestedByName).toBe('Sam')
    })

    it('stops a child answering their own request', async () => {
      const created = await post('/api/requests', kid, { kind: 'meal', text: 'Tacos' })
      const id = created.json<{ id: string }>().id

      const response = await post(`/api/requests/${id}/respond`, kid, { status: 'approved' })
      expect(response.statusCode).toBe(403)
    })

    it('lets a child withdraw their own request but not a sibling’s', async () => {
      const other = await addMember(harness.app, josh, { name: 'Alex', role: 'child', pin: '5555' })
      const created = await post('/api/requests', kid, { kind: 'meal', text: 'Pizza' })
      const id = created.json<{ id: string }>().id

      const bySibling = await harness.app.inject({
        method: 'DELETE',
        url: `/api/requests/${id}`,
        headers: { cookie: other.cookie },
      })
      expect(bySibling.statusCode).toBe(403)

      const byOwner = await harness.app.inject({
        method: 'DELETE',
        url: `/api/requests/${id}`,
        headers: { cookie: kid.cookie },
      })
      expect(byOwner.statusCode).toBe(204)
    })

    it('refuses to remove the last grown-up', async () => {
      const response = await harness.app.inject({
        method: 'DELETE',
        url: `/api/members/${josh.id}`,
        headers: { cookie: josh.cookie },
      })
      expect(response.statusCode).toBe(409)
    })
  })

  describe('shopping list', () => {
    it('puts an approved grocery request straight onto the list', async () => {
      const josh = await bootstrapHousehold(harness.app)
      const kid = await addMember(harness.app, josh, { name: 'Sam', role: 'child', pin: '4321' })

      const created = await post('/api/requests', kid, { kind: 'grocery', text: 'Strawberries' })
      const id = created.json<{ id: string }>().id
      await post(`/api/requests/${id}/respond`, josh, { status: 'approved' })

      const list = await get('/api/shopping', josh)
      const items = list.json<{ items: { text: string; autoReason: string | null }[] }>().items
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({ text: 'Strawberries', autoReason: 'request' })
    })

    it('does not queue the same thing twice', async () => {
      const josh = await bootstrapHousehold(harness.app)
      await post('/api/shopping', josh, { text: 'Butter' })
      const second = await post('/api/shopping', josh, { text: 'Butter' })
      expect(second.statusCode).toBe(409)
    })

    it('suggests what has fallen below par', async () => {
      const josh = await bootstrapHousehold(harness.app)
      const locationId = await firstLocationId(harness.app, josh)
      const productId = await makeProduct(josh, {
        name: 'Milk',
        defaultUnit: 'l',
        parQuantity: 3,
        parUnit: 'l',
      })
      await addStock(josh, productId, locationId, { quantity: 1, unit: 'l' })

      const refill = await post('/api/shopping/refill', josh)
      const added = refill.json<{ added: { text: string; quantity: number }[] }>().added
      expect(added).toHaveLength(1)
      expect(added[0]).toMatchObject({ text: 'Milk', quantity: 2 })
    })

    it('turns bought lines into stock at checkout', async () => {
      const josh = await bootstrapHousehold(harness.app)
      const locationId = await firstLocationId(harness.app, josh)
      const productId = await makeProduct(josh, { name: 'Flour', defaultUnit: 'kg' })

      const item = await post('/api/shopping', josh, {
        productId,
        text: 'Flour',
        quantity: 2,
        unit: 'kg',
      })
      const itemId = item.json<{ id: string }>().id

      const checkout = await post('/api/shopping/checkout', josh, {
        locationId,
        itemIds: [itemId],
      })
      expect(checkout.json<{ added: number }>().added).toBe(1)

      const [row] = await inventory(josh)
      expect(row?.totals[0]).toMatchObject({ quantity: 2, unit: 'kg' })
    })

    it('marks a free-text line bought without inventing a product', async () => {
      const josh = await bootstrapHousehold(harness.app)
      const locationId = await firstLocationId(harness.app, josh)

      const item = await post('/api/shopping', josh, { text: 'Birthday candles' })
      const itemId = item.json<{ id: string }>().id

      const checkout = await post('/api/shopping/checkout', josh, {
        locationId,
        itemIds: [itemId],
      })
      expect(checkout.json<{ added: number; skipped: number }>()).toMatchObject({
        added: 0,
        skipped: 1,
      })
      expect(await inventory(josh)).toHaveLength(0)
    })
  })

  describe('recipes and meal planning', () => {
    async function seedRecipe(actor: Actor, riceId: string) {
      const response = await post('/api/recipes', actor, {
        name: 'Rice bowl',
        servings: 2,
        ingredients: [
          { productId: riceId, name: 'Rice', quantity: 200, unit: 'g' },
          { name: 'Soy sauce', quantity: 2, unit: 'tbsp', optional: true },
        ],
      })
      expect(response.statusCode).toBe(201)
      return response.json<{ id: string }>().id
    }

    it('reports what is missing before you start cooking', async () => {
      const josh = await bootstrapHousehold(harness.app)
      const locationId = await firstLocationId(harness.app, josh)
      const riceId = await makeProduct(josh)
      await addStock(josh, riceId, locationId, { quantity: 150, unit: 'g' })

      const recipeId = await seedRecipe(josh, riceId)
      const availability = await get(`/api/recipes/${recipeId}/availability`, josh)
      const body = availability.json<{
        canCook: boolean
        missingCount: number
        ingredients: { name: string; shortfall: number }[]
      }>()

      expect(body.canCook).toBe(false)
      expect(body.missingCount).toBe(1)
      expect(body.ingredients.find((i) => i.name === 'Rice')?.shortfall).toBe(50)
    })

    it('scales the requirement with the servings asked for', async () => {
      const josh = await bootstrapHousehold(harness.app)
      const riceId = await makeProduct(josh)
      const recipeId = await seedRecipe(josh, riceId)

      const availability = await get(`/api/recipes/${recipeId}/availability?servings=4`, josh)
      const body = availability.json<{ ingredients: { name: string; needed: number }[] }>()
      expect(body.ingredients.find((i) => i.name === 'Rice')?.needed).toBe(400)
    })

    it('ignores a missing optional ingredient', async () => {
      const josh = await bootstrapHousehold(harness.app)
      const locationId = await firstLocationId(harness.app, josh)
      const riceId = await makeProduct(josh)
      await addStock(josh, riceId, locationId, { quantity: 500, unit: 'g' })

      const recipeId = await seedRecipe(josh, riceId)
      const availability = await get(`/api/recipes/${recipeId}/availability`, josh)
      // Soy sauce is absent and optional, so the meal is still cookable.
      expect(availability.json<{ canCook: boolean }>().canCook).toBe(true)
    })

    it('takes ingredients out of the pantry when a meal is cooked', async () => {
      const josh = await bootstrapHousehold(harness.app)
      const locationId = await firstLocationId(harness.app, josh)
      const riceId = await makeProduct(josh)
      await addStock(josh, riceId, locationId, { quantity: 500, unit: 'g' })
      const recipeId = await seedRecipe(josh, riceId)

      const planned = await post('/api/mealplan', josh, {
        date: '2026-09-22',
        slot: 'dinner',
        recipeId,
      })
      const entryId = planned.json<{ id: string }>().id

      const cooked = await post(`/api/mealplan/${entryId}/cook`, josh, {})
      expect(cooked.statusCode).toBe(200)

      const [row] = await inventory(josh)
      expect(row?.totals[0]?.quantity).toBe(300)
    })

    it('puts what was short onto the shopping list', async () => {
      const josh = await bootstrapHousehold(harness.app)
      const locationId = await firstLocationId(harness.app, josh)
      const riceId = await makeProduct(josh)
      await addStock(josh, riceId, locationId, { quantity: 50, unit: 'g' })
      const recipeId = await seedRecipe(josh, riceId)

      const planned = await post('/api/mealplan', josh, {
        date: '2026-09-22',
        slot: 'dinner',
        recipeId,
      })
      const entryId = planned.json<{ id: string }>().id
      await post(`/api/mealplan/${entryId}/cook`, josh, { addShortfallToList: true })

      const list = await get('/api/shopping', josh)
      const items = list.json<{ items: { text: string; autoReason: string | null }[] }>().items
      expect(items.find((item) => item.text === 'Rice')).toMatchObject({ autoReason: 'recipe' })
    })

    it('will not cook the same meal twice', async () => {
      const josh = await bootstrapHousehold(harness.app)
      const riceId = await makeProduct(josh)
      const recipeId = await seedRecipe(josh, riceId)

      const planned = await post('/api/mealplan', josh, {
        date: '2026-09-22',
        slot: 'dinner',
        recipeId,
      })
      const entryId = planned.json<{ id: string }>().id

      await post(`/api/mealplan/${entryId}/cook`, josh, {})
      const again = await post(`/api/mealplan/${entryId}/cook`, josh, {})
      expect(again.statusCode).toBe(409)
    })

    it('matches a loose ingredient name to a stocked product', async () => {
      const josh = await bootstrapHousehold(harness.app)
      const locationId = await firstLocationId(harness.app, josh)
      const riceId = await makeProduct(josh, { name: 'Rice' })
      await addStock(josh, riceId, locationId, { quantity: 500, unit: 'g' })

      const created = await post('/api/recipes', josh, {
        name: 'Plain rice',
        servings: 2,
        // No productId — just the word "rice", as a pasted recipe would have.
        ingredients: [{ name: 'rice', quantity: 100, unit: 'g' }],
      })
      const recipeId = created.json<{ id: string }>().id

      const availability = await get(`/api/recipes/${recipeId}/availability`, josh)
      expect(availability.json<{ canCook: boolean }>().canCook).toBe(true)
    })
  })

  describe('camera scanning', () => {
    const multipart = (fields: { hint?: string }) => {
      const boundary = '----pantrytest'
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      )
      const parts: Buffer[] = [
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`,
        ),
        png,
        Buffer.from('\r\n'),
      ]
      if (fields.hint !== undefined) {
        parts.push(
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="hint"\r\n\r\n${fields.hint}\r\n`,
          ),
        )
      }
      parts.push(Buffer.from(`--${boundary}--\r\n`))
      return { body: Buffer.concat(parts), boundary }
    }

    async function scan(actor: Actor, hint?: string) {
      const { body, boundary } = multipart(hint === undefined ? {} : { hint })
      return harness.app.inject({
        method: 'POST',
        url: '/api/scan',
        headers: {
          cookie: actor.cookie,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload: body,
      })
    }

    it('proposes candidates without touching the inventory', async () => {
      const josh = await bootstrapHousehold(harness.app)
      harness.setVisionItems([
        {
          name: 'Bananas',
          brand: null,
          category: 'produce',
          quantity: 6,
          unit: 'each',
          confidence: 0.9,
        },
        {
          name: 'Oat milk',
          brand: 'Oatly',
          category: 'dairy',
          quantity: 1,
          unit: 'l',
          confidence: 0.7,
        },
      ])

      const response = await scan(josh)
      expect(response.statusCode).toBe(201)
      const batch = response.json<{ status: string; candidates: { name: string }[] }>()
      expect(batch.status).toBe('ready')
      expect(batch.candidates).toHaveLength(2)

      // Nothing is in the pantry until a human says so.
      expect(await inventory(josh)).toHaveLength(0)
    })

    it('adds only the candidates a person accepted', async () => {
      const josh = await bootstrapHousehold(harness.app)
      const locationId = await locationIdNamed(harness.app, josh, 'Fridge')
      harness.setVisionItems([
        {
          name: 'Bananas',
          brand: null,
          category: 'produce',
          quantity: 6,
          unit: 'each',
          confidence: 0.9,
        },
        {
          name: 'Mystery jar',
          brand: null,
          category: 'other',
          quantity: 1,
          unit: 'jar',
          confidence: 0.2,
        },
      ])

      const scanned = await scan(josh)
      const batch = scanned.json<{ id: string; candidates: { id: string; name: string }[] }>()
      const bananas = batch.candidates.find((c) => c.name === 'Bananas')
      const jar = batch.candidates.find((c) => c.name === 'Mystery jar')

      const applied = await post(`/api/scan/${batch.id}/apply`, josh, {
        locationId,
        candidates: [
          { candidateId: bananas?.id, accepted: true, quantity: 5 },
          { candidateId: jar?.id, accepted: false },
        ],
      })
      expect(applied.json<{ added: number }>().added).toBe(1)

      const rows = await inventory(josh)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.product.name).toBe('Bananas')
      // The corrected quantity wins over the model's guess.
      expect(rows[0]?.totals[0]?.quantity).toBe(5)
      expect(rows[0]?.product.source).toBe('vision')
    })

    it('links a scan to a product already in the catalogue', async () => {
      const josh = await bootstrapHousehold(harness.app)
      const locationId = await firstLocationId(harness.app, josh)
      const riceId = await makeProduct(josh, { name: 'Rice', defaultUnit: 'g' })
      await addStock(josh, riceId, locationId, { quantity: 500, unit: 'g' })

      harness.setVisionItems([
        {
          name: 'Rice',
          brand: null,
          category: 'pantry',
          quantity: 1000,
          unit: 'g',
          confidence: 0.8,
        },
      ])
      const scanned = await scan(josh)
      const batch = scanned.json<{
        id: string
        candidates: { id: string; productId: string | null }[]
      }>()
      expect(batch.candidates[0]?.productId).toBe(riceId)

      await post(`/api/scan/${batch.id}/apply`, josh, {
        locationId,
        candidates: [{ candidateId: batch.candidates[0]?.id, accepted: true }],
      })

      const rows = await inventory(josh)
      // One product, two lots — not a duplicate product.
      expect(rows).toHaveLength(1)
      expect(rows[0]?.totals[0]).toMatchObject({ quantity: 1.5, unit: 'kg' })
    })

    it('records a failed scan instead of dropping it silently', async () => {
      const josh = await bootstrapHousehold(harness.app)
      harness.setVisionError(new Error('model exploded'))

      const response = await scan(josh)
      expect(response.statusCode).toBe(500)

      const batches = await get('/api/scan', josh)
      expect(batches.json<{ batches: { status: string }[] }>().batches[0]?.status).toBe('failed')
    })

    it('keeps children out of scanning', async () => {
      const josh = await bootstrapHousehold(harness.app)
      const kid = await addMember(harness.app, josh, { name: 'Sam', role: 'child', pin: '4321' })
      harness.setVisionItems([])

      const response = await scan(kid)
      expect(response.statusCode).toBe(403)
    })

    it('refuses a scan with no photo attached', async () => {
      const josh = await bootstrapHousehold(harness.app)
      const response = await harness.app.inject({
        method: 'POST',
        url: '/api/scan',
        headers: { cookie: josh.cookie, 'content-type': 'application/json' },
        payload: {},
      })
      expect(response.statusCode).toBe(400)
    })
  })

  describe('household isolation', () => {
    it('keeps one household out of another’s pantry', async () => {
      const josh = await bootstrapHousehold(harness.app)
      const locationId = await firstLocationId(harness.app, josh)
      const productId = await makeProduct(josh)
      await addStock(josh, productId, locationId, { quantity: 1, unit: 'kg' })

      // A second household, created directly, must not see the first one's data.
      const [other] = await harness.db
        .insert((await import('./db/schema.js')).households)
        .values({ name: 'Next door' })
        .returning()
      const [neighbour] = await harness.db
        .insert((await import('./db/schema.js')).members)
        .values({
          householdId: other!.id,
          name: 'Neighbour',
          role: 'adult',
          pinHash: await (await import('./auth/pin.js')).hashPin('1111'),
        })
        .returning()

      const login = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { memberId: neighbour!.id, pin: '1111' },
      })
      const cookie = (login.headers['set-cookie'] as string).split(';')[0] ?? ''

      const theirInventory = await harness.app.inject({
        method: 'GET',
        url: '/api/inventory',
        headers: { cookie },
      })
      expect(theirInventory.json<{ items: unknown[] }>().items).toHaveLength(0)
    })
  })
})
