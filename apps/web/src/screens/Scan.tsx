import { useCallback, useEffect, useRef, useState } from 'react'
import type { Location, Product, ScanBatch, ScanCandidate, UnitCode } from '@pantry/shared'
import { api, ApiRequestError, type BarcodeResult } from '../api.js'
import {
  Banner,
  Check,
  Empty,
  Field,
  Segmented,
  Sheet,
  Spinner,
  Stepper,
  UnitSelect,
} from '../components/ui.js'
import { CATEGORY_ICON, todayIso } from '../lib/format.js'
import { startBarcodeScanner, type BarcodeStopper } from '../lib/barcode.js'

type Mode = 'barcode' | 'photo'

export function Scan({ onChanged }: { onChanged: () => void }) {
  const [mode, setMode] = useState<Mode>('barcode')
  const [locations, setLocations] = useState<Location[]>([])
  const [visionAvailable, setVisionAvailable] = useState(true)

  useEffect(() => {
    void api.locations.list().then((result) => setLocations(result.locations))
    void api.health().then((result) => setVisionAvailable(result.vision))
  }, [])

  return (
    <>
      <Segmented<Mode>
        value={mode}
        onChange={setMode}
        options={[
          { value: 'barcode', label: 'Barcode' },
          { value: 'photo', label: 'Photo' },
        ]}
      />
      <div style={{ height: 14 }} />
      {mode === 'barcode' ? (
        <BarcodeScan locations={locations} onChanged={onChanged} />
      ) : (
        <PhotoScan locations={locations} available={visionAvailable} onChanged={onChanged} />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ barcode */

function BarcodeScan({ locations, onChanged }: { locations: Location[]; onChanged: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const stopperRef = useRef<BarcodeStopper | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ upc: string; lookup: BarcodeResult } | null>(null)
  const [manual, setManual] = useState('')

  const stop = useCallback(() => {
    stopperRef.current?.()
    stopperRef.current = null
    setScanning(false)
  }, [])

  // Releasing the camera on unmount matters: a live stream left running is
  // both a battery drain and a light that stays on for no reason.
  useEffect(() => stop, [stop])

  const lookUp = useCallback(async (upc: string) => {
    try {
      setResult({ upc, lookup: await api.products.byBarcode(upc) })
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'Lookup failed')
    }
  }, [])

  const start = async () => {
    setError(null)
    setResult(null)
    const video = videoRef.current
    if (!video) return
    setScanning(true)
    stopperRef.current = await startBarcodeScanner(video, {
      onResult: (code) => {
        setScanning(false)
        stopperRef.current = null
        void lookUp(code)
      },
      onError: (message) => {
        setScanning(false)
        setError(message)
      },
    })
  }

  return (
    <>
      {error ? <Banner kind="error">{error}</Banner> : null}

      <div className="scanner" hidden={!scanning}>
        <video ref={videoRef} muted playsInline />
        <div className="scanner__frame" />
        <div className="scanner__hint">Line the barcode up inside the frame</div>
      </div>

      <div className="stack" style={{ marginTop: 12 }}>
        {scanning ? (
          <button className="btn btn--block" onClick={stop}>
            Stop scanning
          </button>
        ) : (
          <button className="btn btn--primary btn--lg btn--block" onClick={() => void start()}>
            {'\u{1F4F7}'} Scan a barcode
          </button>
        )}

        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault()
            if (manual.trim()) void lookUp(manual.trim())
          }}
        >
          <input
            className="grow"
            value={manual}
            onChange={(event) => setManual(event.target.value.replace(/\D/g, ''))}
            placeholder="or type the digits"
            inputMode="numeric"
            aria-label="Barcode digits"
          />
          <button className="btn" type="submit" disabled={manual.length < 6}>
            Find
          </button>
        </form>
      </div>

      {result ? (
        <AddFromBarcode
          upc={result.upc}
          lookup={result.lookup}
          locations={locations}
          onClose={() => setResult(null)}
          onAdded={() => {
            setResult(null)
            onChanged()
          }}
        />
      ) : null}
    </>
  )
}

function AddFromBarcode({
  upc,
  lookup,
  locations,
  onClose,
  onAdded,
}: {
  upc: string
  lookup: BarcodeResult
  locations: Location[]
  onClose: () => void
  onAdded: () => void
}) {
  const known: Product | null = lookup.product
  const suggestion = lookup.suggestion

  const [name, setName] = useState(known?.name ?? suggestion?.name ?? '')
  const [quantity, setQuantity] = useState(suggestion?.quantity ?? 1)
  const [unit, setUnit] = useState<UnitCode>(known?.defaultUnit ?? suggestion?.unit ?? 'each')
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '')
  const [expiresAt, setExpiresAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.inventory.add({
        ...(known
          ? { productId: known.id }
          : {
              product: {
                name,
                upc,
                brand: suggestion?.brand ?? null,
                category: suggestion?.category ?? 'other',
                defaultUnit: unit,
                imageUrl: suggestion?.imageUrl ?? null,
              },
            }),
        locationId,
        quantity,
        unit,
        ...(expiresAt ? { expiresAt } : {}),
        purchasedAt: todayIso(),
      })
      onAdded()
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'Could not add that')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={known ? 'Add more' : 'New item'} onClose={onClose}>
      {error ? <Banner kind="error">{error}</Banner> : null}
      {lookup.source === 'miss' ? (
        <Banner kind="warn">
          We don&rsquo;t know barcode {upc} yet. Give it a name and it&rsquo;ll be remembered next
          time.
        </Banner>
      ) : null}
      {lookup.source === 'openfoodfacts' ? (
        <Banner kind="info">Found &ldquo;{suggestion?.name}&rdquo; in Open Food Facts.</Banner>
      ) : null}

      <div className="stack">
        <Field label="Name">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={Boolean(known)}
            required
          />
        </Field>

        <div className="field-row">
          <Field label="How many">
            <Stepper value={quantity} onChange={setQuantity} />
          </Field>
          <Field label="Unit">
            <UnitSelect value={unit} onChange={setUnit} />
          </Field>
        </div>

        <Field label="Where does it go?">
          <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Best before" hint="Optional — leave blank if it does not matter.">
          <input
            type="date"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
        </Field>

        <button
          className="btn btn--primary btn--lg btn--block"
          onClick={() => void submit()}
          disabled={busy || !name.trim() || !locationId || quantity <= 0}
        >
          {busy ? 'Adding…' : 'Add to pantry'}
        </button>
      </div>
    </Sheet>
  )
}

/* -------------------------------------------------------------------- photo */

function PhotoScan({
  locations,
  available,
  onChanged,
}: {
  locations: Location[]
  available: boolean
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [batch, setBatch] = useState<ScanBatch | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setBusy(true)
    setError(null)
    try {
      setBatch(await api.scan.submit(Array.from(files).slice(0, 5)))
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'The scan failed')
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  if (!available) {
    return (
      <Empty
        icon={'\u{1F4F7}'}
        title="Photo scanning is switched off"
        hint="Set ANTHROPIC_API_KEY on the server to turn it on. Barcode scanning works either way."
      />
    )
  }

  return (
    <>
      {error ? <Banner kind="error">{error}</Banner> : null}

      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          Lay the shopping out on the counter and take a photo. Everything found comes back as a
          list for you to check before anything is added.
        </p>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="visually-hidden"
          onChange={(event) => void upload(event.target.files)}
        />
        <button
          className="btn btn--primary btn--lg btn--block"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
        >
          {busy ? 'Looking…' : '\u{1F4F8} Take a photo'}
        </button>
      </div>

      {busy ? <Spinner label="Reading the photo" /> : null}

      {batch ? (
        <ReviewScan
          batch={batch}
          locations={locations}
          onClose={() => setBatch(null)}
          onApplied={() => {
            setBatch(null)
            onChanged()
          }}
        />
      ) : null}
    </>
  )
}

interface Draft {
  accepted: boolean
  quantity: number
  unit: UnitCode
  name: string
}

function ReviewScan({
  batch,
  locations,
  onClose,
  onApplied,
}: {
  batch: ScanBatch
  locations: Location[]
  onClose: () => void
  onApplied: () => void
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      batch.candidates.map((candidate) => [
        candidate.id,
        {
          // Anything the model was unsure about starts unchecked, so a low
          // confidence guess cannot slip into the pantry by momentum.
          accepted: candidate.confidence >= 0.6,
          quantity: candidate.quantity,
          unit: candidate.unit,
          name: candidate.name,
        },
      ]),
    ),
  )
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (id: string, patch: Partial<Draft>) =>
    setDrafts((current) => ({ ...current, [id]: { ...current[id]!, ...patch } }))

  const acceptedCount = Object.values(drafts).filter((draft) => draft.accepted).length

  const apply = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.scan.apply(batch.id, {
        locationId,
        candidates: batch.candidates.map((candidate) => {
          const draft = drafts[candidate.id]!
          return {
            candidateId: candidate.id,
            accepted: draft.accepted,
            name: draft.name,
            quantity: draft.quantity,
            unit: draft.unit,
          }
        }),
      })
      onApplied()
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'Could not add those')
    } finally {
      setBusy(false)
    }
  }

  if (batch.candidates.length === 0) {
    return (
      <Sheet title="Nothing found" onClose={onClose}>
        <Empty
          icon={'\u{1F50D}'}
          title="No groceries spotted"
          hint="Try more light, or fewer items in one shot."
        />
      </Sheet>
    )
  }

  return (
    <Sheet
      title={`Found ${batch.candidates.length} thing${batch.candidates.length === 1 ? '' : 's'}`}
      onClose={onClose}
    >
      {error ? <Banner kind="error">{error}</Banner> : null}
      <p className="muted" style={{ marginTop: 0 }}>
        Uncheck anything wrong and fix the amounts. Nothing is added until you tap below.
      </p>

      <ul className="list">
        {batch.candidates.map((candidate) => (
          <CandidateRow
            key={candidate.id}
            candidate={candidate}
            draft={drafts[candidate.id]!}
            onChange={(patch) => update(candidate.id, patch)}
          />
        ))}
      </ul>

      <div className="stack" style={{ marginTop: 14 }}>
        <Field label="Put it all in">
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
          onClick={() => void apply()}
          disabled={busy || acceptedCount === 0 || !locationId}
        >
          {busy ? 'Adding…' : `Add ${acceptedCount} to pantry`}
        </button>
      </div>
    </Sheet>
  )
}

function CandidateRow({
  candidate,
  draft,
  onChange,
}: {
  candidate: ScanCandidate
  draft: Draft
  onChange: (patch: Partial<Draft>) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <li className="card" style={{ padding: 12 }}>
      <div className="row">
        <Check
          checked={draft.accepted}
          onChange={(accepted) => onChange({ accepted })}
          label={`Include ${candidate.name}`}
        />
        <span className="item__thumb" aria-hidden="true">
          {CATEGORY_ICON[candidate.category] ?? '\u{1F4E6}'}
        </span>
        <button
          type="button"
          className="grow"
          style={{ background: 'none', border: 0, textAlign: 'left', padding: 0 }}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="item__title">{draft.name}</span>
          <div className="muted">
            {draft.quantity} {draft.unit === 'each' ? '' : draft.unit}
            {candidate.brand ? ` · ${candidate.brand}` : ''}
          </div>
        </button>
        {candidate.productId ? <span className="chip chip--ok">Known</span> : null}
        {candidate.confidence < 0.6 ? <span className="chip chip--warn">Unsure</span> : null}
      </div>

      {open ? (
        <div className="stack" style={{ marginTop: 10 }}>
          <Field label="Name">
            <input
              value={draft.name}
              onChange={(event) => onChange({ name: event.target.value })}
            />
          </Field>
          <div className="field-row">
            <Field label="How many">
              <Stepper value={draft.quantity} onChange={(quantity) => onChange({ quantity })} />
            </Field>
            <Field label="Unit">
              <UnitSelect value={draft.unit} onChange={(unit) => onChange({ unit })} />
            </Field>
          </div>
        </div>
      ) : null}
    </li>
  )
}
