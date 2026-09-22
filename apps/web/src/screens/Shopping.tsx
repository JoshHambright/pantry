import { useEffect, useState } from 'react'
import type { Location, ShoppingItem } from '@pantry/shared'
import { api, ApiRequestError } from '../api.js'
import { Banner, Check, Empty, Field, Sheet, Spinner } from '../components/ui.js'
import { formatAmount } from '../lib/format.js'

const REASON_LABEL: Record<string, string> = {
  par: 'running low',
  recipe: 'for a recipe',
  request: 'asked for',
}

export function Shopping({ isAdult }: { isAdult: boolean }) {
  const [items, setItems] = useState<ShoppingItem[] | null>(null)
  const [locations, setLocations] = useState<Location[]>([])
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [checkout, setCheckout] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    api.shopping
      .list()
      .then((result) => setItems(result.items))
      .catch(() => setError('Could not load the list'))
    void api.locations.list().then((result) => setLocations(result.locations))
  }, [reload])

  const refresh = () => setReload((current) => current + 1)

  const add = async () => {
    if (!text.trim()) return
    setError(null)
    try {
      await api.shopping.add({ text: text.trim() })
      setText('')
      refresh()
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'Could not add that')
    }
  }

  const toggle = async (item: ShoppingItem) => {
    const next = item.status === 'in_cart' ? 'needed' : 'in_cart'
    await api.shopping.update(item.id, { status: next }).catch(() => {})
    refresh()
  }

  if (error && !items) return <Banner kind="error">{error}</Banner>
  if (!items) return <Spinner />

  const open = items.filter((item) => item.status !== 'bought')
  const inCart = open.filter((item) => item.status === 'in_cart')
  const bought = items.filter((item) => item.status === 'bought')

  return (
    <>
      {error ? <Banner kind="error">{error}</Banner> : null}
      {note ? <Banner kind="info">{note}</Banner> : null}

      <form
        className="row"
        style={{ marginBottom: 14 }}
        onSubmit={(event) => {
          event.preventDefault()
          void add()
        }}
      >
        <input
          className="grow"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Add something"
          aria-label="Add something to the list"
        />
        <button className="btn btn--primary" type="submit" disabled={!text.trim()}>
          Add
        </button>
      </form>

      {isAdult ? (
        <div className="row row--wrap" style={{ marginBottom: 14 }}>
          <button
            className="btn btn--sm"
            onClick={() =>
              void api.shopping.refill().then((result) => {
                setNote(
                  result.added.length === 0
                    ? // Not "nothing is low" — something may be low and already
                      // queued, and saying otherwise contradicts the list below.
                      'Everything running low is already on the list.'
                    : `Added ${result.added.length} low item(s).`,
                )
                refresh()
              })
            }
          >
            Top up from par levels
          </button>
          <button
            className="btn btn--sm btn--primary"
            disabled={inCart.length === 0}
            onClick={() => setCheckout(true)}
          >
            {inCart.length === 0 ? 'Put the shopping away' : `Put ${inCart.length} away`}
          </button>
        </div>
      ) : null}

      {open.length === 0 ? (
        <Empty icon={'\u{1F6D2}'} title="Nothing on the list" hint="Add something above." />
      ) : (
        <ul className="list">
          {open.map((item) => (
            <li key={item.id} className="item item--flat">
              <Check
                checked={item.status === 'in_cart'}
                onChange={() => void toggle(item)}
                label={`Mark ${item.text} as in the cart`}
              />
              <span className="grow truncate">
                <span
                  className="item__title"
                  style={{
                    textDecoration: item.status === 'in_cart' ? 'line-through' : undefined,
                    opacity: item.status === 'in_cart' ? 0.6 : 1,
                  }}
                >
                  {item.text}
                </span>
                <div className="muted">
                  {formatAmount(item.quantity, item.unit)}
                  {item.autoReason ? ` · ${REASON_LABEL[item.autoReason]}` : ''}
                  {item.requestedByName ? ` · ${item.requestedByName}` : ''}
                </div>
              </span>
              <button
                className="btn btn--ghost btn--sm"
                aria-label={`Remove ${item.text}`}
                onClick={() => void api.shopping.remove(item.id).then(refresh)}
              >
                &#10005;
              </button>
            </li>
          ))}
        </ul>
      )}

      {bought.length > 0 ? (
        <section className="section" style={{ marginTop: 22 }}>
          <div className="section__head">
            <h2>Already bought</h2>
          </div>
          <ul className="list">
            {bought.slice(0, 10).map((item) => (
              <li key={item.id} className="item item--flat">
                <span className="grow truncate muted">{item.text}</span>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => void api.shopping.remove(item.id).then(refresh)}
                  aria-label={`Clear ${item.text}`}
                >
                  &#10005;
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {checkout ? (
        <CheckoutSheet
          items={inCart}
          locations={locations}
          onClose={() => setCheckout(false)}
          onDone={(added, skipped) => {
            setCheckout(false)
            setNote(
              skipped > 0
                ? `Added ${added} to the pantry. ${skipped} had no product to file them under.`
                : `Added ${added} to the pantry.`,
            )
            refresh()
          }}
        />
      ) : null}
    </>
  )
}

/** Turns the trolley into stock in one go, at the end of a shop. */
function CheckoutSheet({
  items,
  locations,
  onClose,
  onDone,
}: {
  items: ShoppingItem[]
  locations: Location[]
  onClose: () => void
  onDone: (added: number, skipped: number) => void
}) {
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const linked = items.filter((item) => item.productId)
  const loose = items.filter((item) => !item.productId)

  return (
    <Sheet title="Put the shopping away" onClose={onClose}>
      {error ? <Banner kind="error">{error}</Banner> : null}

      <p className="muted" style={{ marginTop: 0 }}>
        {linked.length} item(s) will be added to the pantry.
        {loose.length > 0
          ? ` ${loose.length} are just notes, so they will be ticked off without being tracked.`
          : ''}
      </p>

      <Field label="Where did it go?">
        <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </Field>

      <button
        className="btn btn--primary btn--lg btn--block"
        style={{ marginTop: 14 }}
        disabled={busy || !locationId || items.length === 0}
        onClick={() => {
          setBusy(true)
          setError(null)
          api.shopping
            .checkout({ locationId, itemIds: items.map((item) => item.id) })
            .then((result) => onDone(result.added, result.skipped))
            .catch((caught: unknown) => {
              setError(caught instanceof ApiRequestError ? caught.message : 'That did not work')
              setBusy(false)
            })
        }}
      >
        {busy ? 'Putting away…' : 'Done shopping'}
      </button>
    </Sheet>
  )
}
