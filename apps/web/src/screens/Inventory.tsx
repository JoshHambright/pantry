import { useEffect, useMemo, useState } from 'react'
import type { Location, StockRow, UnitCode } from '@pantry/shared'
import { api, ApiRequestError } from '../api.js'
import {
  Banner,
  Empty,
  ExpiryChip,
  Field,
  Sheet,
  Spinner,
  Stepper,
  UnitSelect,
} from '../components/ui.js'
import { CATEGORY_ICON, formatAmount, formatTotals, relativeDay, todayIso } from '../lib/format.js'

export function Inventory({ isAdult, onChanged }: { isAdult: boolean; onChanged: () => void }) {
  const [rows, setRows] = useState<StockRow[] | null>(null)
  const [locations, setLocations] = useState<Location[]>([])
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<StockRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    api.inventory
      .list()
      .then((result) => setRows(result.items))
      .catch(() => setError('Could not load the pantry'))
    void api.locations.list().then((result) => setLocations(result.locations))
  }, [reload])

  const filtered = useMemo(() => {
    if (!rows) return null
    const key = search.toLowerCase().trim()
    if (!key) return rows
    return rows.filter(
      (row) =>
        row.product.name.toLowerCase().includes(key) ||
        (row.product.brand?.toLowerCase().includes(key) ?? false),
    )
  }, [rows, search])

  const refresh = () => {
    setReload((current) => current + 1)
    onChanged()
  }

  if (error) return <Banner kind="error">{error}</Banner>
  if (!filtered) return <Spinner />

  const today = todayIso()

  return (
    <>
      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search the pantry"
        type="search"
        aria-label="Search the pantry"
        style={{ marginBottom: 12 }}
      />

      {filtered.length === 0 ? (
        <Empty
          icon={'\u{1F9FA}'}
          title={search ? 'Nothing matches' : 'The pantry is empty'}
          hint={search ? undefined : 'Scan something in to get started.'}
        />
      ) : (
        <ul className="list">
          {filtered.map((row) => (
            <li key={row.product.id}>
              <button type="button" className="item" onClick={() => setOpen(row)}>
                <span className="item__thumb" aria-hidden="true">
                  {CATEGORY_ICON[row.product.category] ?? '\u{1F4E6}'}
                </span>
                <span className="grow truncate">
                  <span className="item__title">{row.product.name}</span>
                  <div className="muted">
                    {formatTotals(row.totals)}
                    {row.lots.length > 1 ? ` · ${row.lots.length} lots` : ''}
                  </div>
                </span>
                {row.soonestExpiry ? (
                  <span className="muted">{relativeDay(row.soonestExpiry, today)}</span>
                ) : null}
                <ExpiryChip status={row.worstExpiry} date={row.soonestExpiry} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <ProductSheet
          row={open}
          locations={locations}
          isAdult={isAdult}
          onClose={() => setOpen(null)}
          onChanged={() => {
            setOpen(null)
            refresh()
          }}
        />
      ) : null}
    </>
  )
}

function ProductSheet({
  row,
  locations,
  isAdult,
  onClose,
  onChanged,
}: {
  row: StockRow
  locations: Location[]
  isAdult: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [useAmount, setUseAmount] = useState(1)
  const [useUnit, setUseUnit] = useState<UnitCode>(row.totals[0]?.unit ?? row.product.defaultUnit)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const today = todayIso()

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      onChanged()
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'That did not work')
      setBusy(false)
    }
  }

  return (
    <Sheet title={row.product.name} onClose={onClose}>
      {error ? <Banner kind="error">{error}</Banner> : null}

      <p className="muted" style={{ marginTop: 0 }}>
        {formatTotals(row.totals)} on hand
        {row.product.brand ? ` · ${row.product.brand}` : ''}
      </p>

      <h3 style={{ marginBottom: 8 }}>Where it is</h3>
      <ul className="list">
        {row.lots.map((lot) => (
          <li key={lot.id} className="item item--flat">
            <span className="grow">
              <span className="item__title">{formatAmount(lot.quantity, lot.unit)}</span>
              <div className="muted">
                {lot.locationName}
                {lot.expiresAt ? ` · ${relativeDay(lot.expiresAt, today)}` : ''}
              </div>
            </span>
            <ExpiryChip status={lot.expiry} date={lot.expiresAt} />
            {isAdult ? (
              <button
                className="btn btn--sm btn--danger"
                disabled={busy}
                onClick={() => void run(() => api.inventory.removeLot(lot.id, true))}
                aria-label={`Throw out ${formatAmount(lot.quantity, lot.unit)}`}
              >
                Bin it
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {isAdult ? (
        <>
          <h3 style={{ margin: '18px 0 8px' }}>Use some</h3>
          <div className="field-row">
            <Field label="How much">
              <Stepper value={useAmount} onChange={setUseAmount} />
            </Field>
            <Field label="Unit">
              <UnitSelect value={useUnit} onChange={setUseUnit} />
            </Field>
          </div>
          <button
            className="btn btn--primary btn--block"
            style={{ marginTop: 10 }}
            disabled={busy || useAmount <= 0}
            onClick={() =>
              void run(() =>
                api.inventory.consume({
                  productId: row.product.id,
                  quantity: useAmount,
                  unit: useUnit,
                }),
              )
            }
          >
            Take it out
          </button>

          <AddMore
            row={row}
            locations={locations}
            busy={busy}
            onAdd={(body) => void run(() => api.inventory.add(body))}
          />
        </>
      ) : null}
    </Sheet>
  )
}

function AddMore({
  row,
  locations,
  busy,
  onAdd,
}: {
  row: StockRow
  locations: Location[]
  busy: boolean
  onAdd: (body: Record<string, unknown>) => void
}) {
  const [quantity, setQuantity] = useState(1)
  const [unit, setUnit] = useState<UnitCode>(row.product.defaultUnit)
  const [locationId, setLocationId] = useState(row.lots[0]?.locationId ?? locations[0]?.id ?? '')
  const [expiresAt, setExpiresAt] = useState('')

  return (
    <>
      <h3 style={{ margin: '18px 0 8px' }}>Add more</h3>
      <div className="stack">
        <div className="field-row">
          <Field label="How many">
            <Stepper value={quantity} onChange={setQuantity} />
          </Field>
          <Field label="Unit">
            <UnitSelect value={unit} onChange={setUnit} />
          </Field>
        </div>
        <Field label="Where">
          <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Best before">
          <input
            type="date"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
        </Field>
        <button
          className="btn btn--block"
          disabled={busy || quantity <= 0 || !locationId}
          onClick={() =>
            onAdd({
              productId: row.product.id,
              locationId,
              quantity,
              unit,
              ...(expiresAt ? { expiresAt } : {}),
              purchasedAt: todayIso(),
            })
          }
        >
          Add to pantry
        </button>
      </div>
    </>
  )
}
