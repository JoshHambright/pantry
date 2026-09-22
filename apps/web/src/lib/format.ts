import { formatQuantity, type StockTotal, type UnitCode } from '@pantry/shared'

export const formatTotals = (totals: readonly StockTotal[]): string =>
  totals.length === 0
    ? 'none left'
    : totals.map((total) => formatQuantity(total.quantity, total.unit)).join(' + ')

export const formatAmount = (quantity: number, unit: UnitCode): string =>
  formatQuantity(quantity, unit)

const DAY = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

export function formatDate(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? iso : DAY.format(parsed)
}

export function relativeDay(iso: string, today: string): string {
  if (iso === today) return 'Today'
  const days = Math.round(
    (Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  )
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  if (days < 0) return `${Math.abs(days)} days ago`
  if (days < 7) return `in ${days} days`
  return formatDate(iso)
}

export const todayIso = (): string => {
  // Local date, not UTC — "what's for dinner tonight" is a local question.
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

export function addDays(iso: string, days: number): string {
  const parsed = new Date(`${iso}T00:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

export const CATEGORY_ICON: Record<string, string> = {
  produce: '\u{1F955}',
  dairy: '\u{1F95B}',
  meat: '\u{1F356}',
  seafood: '\u{1F41F}',
  bakery: '\u{1F35E}',
  frozen: '\u{2744}\u{FE0F}',
  pantry: '\u{1F35A}',
  canned: '\u{1F96B}',
  snacks: '\u{1F36A}',
  beverages: '\u{1F964}',
  condiments: '\u{1F962}',
  spices: '\u{1F9C2}',
  baking: '\u{1F9C1}',
  household: '\u{1F9F4}',
  other: '\u{1F4E6}',
}
