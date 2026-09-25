/** Response shapes. The API returns these; the web app consumes them. */

import type {
  Category,
  InventoryEventKind,
  MealSlot,
  MemberRole,
  ProductSource,
  RequestKind,
  RequestStatus,
  ScanStatus,
  ShoppingStatus,
  StorageKind,
} from './domain.js'
import type { ExpiryStatus, StockTotal } from './inventory.js'
import type { UnitCode } from './units.js'

export interface Member {
  id: string
  name: string
  role: MemberRole
  color: string
  createdAt: string
}

export interface Location {
  id: string
  name: string
  kind: StorageKind
  sortOrder: number
}

export interface Product {
  id: string
  name: string
  brand: string | null
  upc: string | null
  category: Category
  defaultUnit: UnitCode
  imageUrl: string | null
  parQuantity: number | null
  parUnit: UnitCode | null
  notes: string | null
  source: ProductSource
}

export interface Lot {
  id: string
  productId: string
  locationId: string
  quantity: number
  unit: UnitCode
  expiresAt: string | null
  purchasedAt: string | null
  note: string | null
  createdAt: string
}

/** A product plus everything the inventory screen needs to render one row. */
export interface StockRow {
  product: Product
  totals: StockTotal[]
  lots: (Lot & { locationName: string; expiry: ExpiryStatus })[]
  /** How far below par, in the par unit. Zero or null when fine or unset. */
  parShortfall: number | null
  soonestExpiry: string | null
  worstExpiry: ExpiryStatus
}

export interface InventoryEvent {
  id: string
  kind: InventoryEventKind
  productId: string
  productName: string
  quantity: number
  unit: UnitCode
  memberId: string | null
  memberName: string | null
  note: string | null
  createdAt: string
}

export interface ShoppingItem {
  id: string
  productId: string | null
  text: string
  quantity: number
  unit: UnitCode
  status: ShoppingStatus
  note: string | null
  /** Set when the line was generated rather than typed. */
  autoReason: 'par' | 'recipe' | 'request' | null
  requestedById: string | null
  requestedByName: string | null
  createdAt: string
}

export interface FamilyRequest {
  id: string
  kind: RequestKind
  text: string
  note: string | null
  status: RequestStatus
  response: string | null
  requestedById: string
  requestedByName: string
  createdAt: string
  respondedAt: string | null
}

export interface RecipeIngredient {
  id: string
  productId: string | null
  name: string
  quantity: number
  unit: UnitCode
  optional: boolean
}

export interface Recipe {
  id: string
  name: string
  servings: number
  instructions: string | null
  sourceUrl: string | null
  tags: string[]
  ingredients: RecipeIngredient[]
}

/** Per-ingredient verdict for "can we cook this tonight?". */
export interface IngredientAvailability {
  ingredientId: string
  name: string
  needed: number
  unit: UnitCode
  onHand: number
  shortfall: number
  optional: boolean
  /** True when stock exists but in a unit we refuse to guess a conversion for. */
  unknownUnit: boolean
}

export interface RecipeAvailability {
  recipeId: string
  servings: number
  canCook: boolean
  missingCount: number
  ingredients: IngredientAvailability[]
}

/** A recipe read off a web page, offered for confirmation. Nothing is saved. */
export interface ImportedIngredient {
  name: string
  quantity: number
  unit: UnitCode
  /** The original line, so a human can check what we made of it. */
  raw: string
}

export interface ImportedRecipe {
  name: string
  servings: number
  instructions: string | null
  sourceUrl: string
  ingredients: ImportedIngredient[]
}

export interface MealPlanEntry {
  id: string
  date: string
  slot: MealSlot
  recipeId: string | null
  recipeName: string | null
  customText: string | null
  note: string | null
  servings: number | null
  cookedAt: string | null
  createdById: string | null
}

export interface ScanCandidate {
  id: string
  name: string
  brand: string | null
  upc: string | null
  category: Category
  quantity: number
  unit: UnitCode
  confidence: number
  /** Set when the guess matched something already in the product catalogue. */
  productId: string | null
  /**
   * Where this item probably belongs, from its category. One photo of a shop
   * holds fridge, freezer and cupboard items, so a single destination for the
   * whole batch would guarantee a tidy-up afterwards.
   */
  suggestedLocationId: string | null
  accepted: boolean
}

export interface ScanBatch {
  id: string
  status: ScanStatus
  note: string | null
  candidates: ScanCandidate[]
  createdAt: string
  error: string | null
}

export interface SessionInfo {
  member: Member
  household: { id: string; name: string }
}

export interface DashboardSummary {
  productCount: number
  lotCount: number
  expiringSoon: StockRow[]
  expired: StockRow[]
  lowStock: StockRow[]
  openRequests: FamilyRequest[]
  shoppingCount: number
  todaysMeals: MealPlanEntry[]
}

export interface ApiError {
  error: string
  message: string
  details?: unknown
}
