/**
 * Typed API client. Every response shape comes from @pantry/shared, so a change
 * to the server contract breaks this file at compile time rather than at
 * dinnertime.
 */

import type {
  ApiError,
  DashboardSummary,
  FamilyRequest,
  InventoryEvent,
  Location,
  Lot,
  MealPlanEntry,
  Member,
  Product,
  Recipe,
  RecipeAvailability,
  ScanBatch,
  SessionInfo,
  ShoppingItem,
  StockRow,
  UnitCode,
} from '@pantry/shared'

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; formData?: FormData } = {},
): Promise<T> {
  const init: RequestInit = {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
  }

  if (options.formData) {
    init.body = options.formData
  } else if (options.body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(options.body)
  }

  let response: Response
  try {
    response = await fetch(`/api${path}`, init)
  } catch {
    throw new ApiRequestError(0, 'offline', 'Cannot reach the pantry server')
  }

  if (response.status === 204) return undefined as T

  const text = await response.text()
  const parsed: unknown = text === '' ? null : JSON.parse(text)

  if (!response.ok) {
    const error = parsed as ApiError | null
    throw new ApiRequestError(
      response.status,
      error?.error ?? 'error',
      error?.message ?? 'Something went wrong',
      error?.details,
    )
  }

  return parsed as T
}

export interface BarcodeResult {
  source: 'known' | 'openfoodfacts' | 'miss'
  product: Product | null
  suggestion: {
    name: string
    brand: string | null
    upc: string
    category: Product['category']
    imageUrl: string | null
    quantity: number | null
    unit: UnitCode | null
  } | null
}

export const api = {
  health: () => request<{ ok: boolean; vision: boolean }>('/health'),

  auth: {
    members: () =>
      request<{ members: Pick<Member, 'id' | 'name' | 'role' | 'color'>[]; bootstrapped: boolean }>(
        '/auth/members',
      ),
    bootstrap: (body: { householdName: string; memberName: string; pin: string }) =>
      request<Member>('/auth/bootstrap', { method: 'POST', body }),
    login: (body: { memberId: string; pin: string }) =>
      request<Member>('/auth/login', { method: 'POST', body }),
    logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
    session: () => request<SessionInfo>('/auth/session'),
  },

  members: {
    list: () => request<{ members: Member[] }>('/members'),
    create: (body: { name: string; role: 'adult' | 'child'; pin: string; color?: string }) =>
      request<Member>('/members', { method: 'POST', body }),
    remove: (id: string) => request<void>(`/members/${id}`, { method: 'DELETE' }),
  },

  locations: {
    list: () => request<{ locations: Location[] }>('/locations'),
    create: (body: { name: string; kind: Location['kind'] }) =>
      request<Location>('/locations', { method: 'POST', body }),
    remove: (id: string) => request<void>(`/locations/${id}`, { method: 'DELETE' }),
  },

  products: {
    list: (search?: string) =>
      request<{ products: Product[] }>(
        `/products${search ? `?search=${encodeURIComponent(search)}` : ''}`,
      ),
    create: (body: Partial<Product> & { name: string }) =>
      request<Product>('/products', { method: 'POST', body }),
    update: (id: string, body: Partial<Product>) =>
      request<Product>(`/products/${id}`, { method: 'PATCH', body }),
    remove: (id: string) => request<void>(`/products/${id}`, { method: 'DELETE' }),
    byBarcode: (upc: string) => request<BarcodeResult>(`/products/barcode/${upc}`),
  },

  inventory: {
    list: (search?: string) =>
      request<{ items: StockRow[] }>(
        `/inventory${search ? `?search=${encodeURIComponent(search)}` : ''}`,
      ),
    add: (body: Record<string, unknown>) => request<Lot>('/inventory', { method: 'POST', body }),
    updateLot: (id: string, body: Record<string, unknown>) =>
      request<Lot & { removed: boolean }>(`/inventory/lots/${id}`, { method: 'PATCH', body }),
    removeLot: (id: string, discarded = false) =>
      request<void>(`/inventory/lots/${id}?discarded=${discarded}`, { method: 'DELETE' }),
    consume: (body: { productId: string; quantity: number; unit: UnitCode; note?: string }) =>
      request<{ consumed: number; shortfall: number }>('/inventory/consume', {
        method: 'POST',
        body,
      }),
    events: (limit = 50) =>
      request<{ events: InventoryEvent[] }>(`/inventory/events?limit=${limit}`),
  },

  shopping: {
    list: () => request<{ items: ShoppingItem[] }>('/shopping'),
    add: (body: { text: string; productId?: string | null; quantity?: number; unit?: UnitCode }) =>
      request<ShoppingItem>('/shopping', { method: 'POST', body }),
    update: (id: string, body: Record<string, unknown>) =>
      request<ShoppingItem>(`/shopping/${id}`, { method: 'PATCH', body }),
    remove: (id: string) => request<void>(`/shopping/${id}`, { method: 'DELETE' }),
    refill: () => request<{ added: ShoppingItem[] }>('/shopping/refill', { method: 'POST' }),
    checkout: (body: { locationId: string; itemIds: string[] }) =>
      request<{ added: number; skipped: number }>('/shopping/checkout', { method: 'POST', body }),
  },

  requests: {
    list: () => request<{ requests: FamilyRequest[] }>('/requests'),
    create: (body: { kind: 'meal' | 'grocery'; text: string; note?: string }) =>
      request<FamilyRequest>('/requests', { method: 'POST', body }),
    respond: (id: string, body: { status: FamilyRequest['status']; response?: string }) =>
      request<FamilyRequest>(`/requests/${id}/respond`, { method: 'POST', body }),
    remove: (id: string) => request<void>(`/requests/${id}`, { method: 'DELETE' }),
  },

  recipes: {
    list: () => request<{ recipes: Recipe[] }>('/recipes'),
    get: (id: string) => request<Recipe>(`/recipes/${id}`),
    availability: () => request<{ availability: RecipeAvailability[] }>('/recipes/availability'),
    create: (body: Record<string, unknown>) =>
      request<Recipe>('/recipes', { method: 'POST', body }),
    update: (id: string, body: Record<string, unknown>) =>
      request<Recipe>(`/recipes/${id}`, { method: 'PATCH', body }),
    remove: (id: string) => request<void>(`/recipes/${id}`, { method: 'DELETE' }),
  },

  mealplan: {
    range: (from: string, to: string) =>
      request<{ from: string; to: string; entries: MealPlanEntry[] }>(
        `/mealplan?from=${from}&to=${to}`,
      ),
    add: (body: Record<string, unknown>) =>
      request<MealPlanEntry>('/mealplan', { method: 'POST', body }),
    remove: (id: string) => request<void>(`/mealplan/${id}`, { method: 'DELETE' }),
    cook: (id: string, body: { servings?: number; addShortfallToList?: boolean } = {}) =>
      request<{
        recipe: string
        servings: number
        used: { name: string; quantity: number; unit: string }[]
        short: { name: string; quantity: number; unit: string }[]
      }>(`/mealplan/${id}/cook`, { method: 'POST', body }),
  },

  scan: {
    submit: (files: File[], hint?: string) => {
      const formData = new FormData()
      for (const file of files) formData.append('photo', file)
      if (hint) formData.append('hint', hint)
      return request<ScanBatch>('/scan', { method: 'POST', formData })
    },
    get: (id: string) => request<ScanBatch>(`/scan/${id}`),
    apply: (
      id: string,
      body: {
        /** Where anything without its own destination goes. */
        locationId: string
        candidates: {
          candidateId: string
          accepted: boolean
          name?: string
          quantity?: number
          unit?: UnitCode
          locationId?: string
        }[]
      },
    ) => request<{ added: number }>(`/scan/${id}/apply`, { method: 'POST', body }),
  },

  dashboard: () => request<DashboardSummary>('/dashboard'),
}
