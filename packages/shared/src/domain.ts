/** Closed vocabularies shared by the database, the API and the UI. */

export const MEMBER_ROLES = ['adult', 'child'] as const
export type MemberRole = (typeof MEMBER_ROLES)[number]

export const STORAGE_KINDS = ['pantry', 'fridge', 'freezer', 'other'] as const
export type StorageKind = (typeof STORAGE_KINDS)[number]

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const
export type MealSlot = (typeof MEAL_SLOTS)[number]

export const REQUEST_KINDS = ['meal', 'grocery'] as const
export type RequestKind = (typeof REQUEST_KINDS)[number]

export const REQUEST_STATUSES = ['open', 'approved', 'declined', 'done'] as const
export type RequestStatus = (typeof REQUEST_STATUSES)[number]

export const SHOPPING_STATUSES = ['needed', 'in_cart', 'bought'] as const
export type ShoppingStatus = (typeof SHOPPING_STATUSES)[number]

export const INVENTORY_EVENT_KINDS = [
  'added',
  'consumed',
  'adjusted',
  'discarded',
  'moved',
] as const
export type InventoryEventKind = (typeof INVENTORY_EVENT_KINDS)[number]

export const PRODUCT_SOURCES = ['manual', 'openfoodfacts', 'vision'] as const
export type ProductSource = (typeof PRODUCT_SOURCES)[number]

export const SCAN_STATUSES = ['pending', 'ready', 'applied', 'failed', 'discarded'] as const
export type ScanStatus = (typeof SCAN_STATUSES)[number]

export const CATEGORIES = [
  'produce',
  'dairy',
  'meat',
  'seafood',
  'bakery',
  'frozen',
  'pantry',
  'canned',
  'snacks',
  'beverages',
  'condiments',
  'spices',
  'baking',
  'household',
  'other',
] as const
export type Category = (typeof CATEGORIES)[number]

/** Where a category most likely belongs, used to pre-select a location on scan. */
export const CATEGORY_DEFAULT_STORAGE: Readonly<Record<Category, StorageKind>> = {
  produce: 'fridge',
  dairy: 'fridge',
  meat: 'fridge',
  seafood: 'freezer',
  bakery: 'pantry',
  frozen: 'freezer',
  pantry: 'pantry',
  canned: 'pantry',
  snacks: 'pantry',
  beverages: 'fridge',
  condiments: 'fridge',
  spices: 'pantry',
  baking: 'pantry',
  household: 'other',
  other: 'pantry',
}

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value)
}
