import { useEffect, useRef, type ChangeEvent, type ReactNode } from 'react'
import { UNIT_CODES, unitDef, type UnitCode } from '@pantry/shared'

export function Banner({
  kind = 'info',
  children,
}: {
  kind?: 'info' | 'error' | 'warn'
  children: ReactNode
}) {
  return (
    <div className={`banner banner--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  )
}

export function Empty({
  icon,
  title,
  hint,
}: {
  icon: string
  title: string
  hint?: string | undefined
}) {
  return (
    <div className="empty">
      <span className="empty__icon" aria-hidden="true">
        {icon}
      </span>
      <div>{title}</div>
      {hint ? <div className="muted">{hint}</div> : null}
    </div>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status">
      <div className="spinner" />
      <span className="visually-hidden">{label}</span>
    </div>
  )
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string | undefined
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint ? <span className="muted">{hint}</span> : null}
    </label>
  )
}

/**
 * A bottom sheet. Closes on Escape and on a backdrop tap, and traps focus on
 * open so a phone keyboard lands in the right place.
 */
export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode | undefined
}) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    panel.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="sheet-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="sheet" ref={panel} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet__head">
          <h2>{title}</h2>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
        {footer ? <div style={{ marginTop: 16 }}>{footer}</div> : null}
      </div>
    </div>
  )
}

export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
}: {
  value: number
  onChange: (next: number) => void
  step?: number
  min?: number
}) {
  const clamp = (next: number) => Math.max(min, Math.round(next * 1000) / 1000)

  return (
    <div className="stepper">
      <button type="button" onClick={() => onChange(clamp(value - step))} aria-label="Less">
        &minus;
      </button>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        min={min}
        step={step}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const next = Number.parseFloat(event.target.value)
          onChange(Number.isFinite(next) ? clamp(next) : min)
        }}
        aria-label="Amount"
      />
      <button type="button" onClick={() => onChange(clamp(value + step))} aria-label="More">
        +
      </button>
    </div>
  )
}

/** Units grouped so the list reads sensibly instead of as 24 flat options. */
const UNIT_GROUPS: { label: string; units: UnitCode[] }[] = [
  { label: 'Count', units: UNIT_CODES.filter((code) => unitDef(code).dimension === 'count') },
  { label: 'Weight', units: UNIT_CODES.filter((code) => unitDef(code).dimension === 'mass') },
  { label: 'Volume', units: UNIT_CODES.filter((code) => unitDef(code).dimension === 'volume') },
]

export function UnitSelect({
  value,
  onChange,
}: {
  value: UnitCode
  onChange: (next: UnitCode) => void
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as UnitCode)}
      aria-label="Unit"
    >
      {UNIT_GROUPS.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.units.map((code) => (
            <option key={code} value={code}>
              {code === 'each' ? 'each' : unitDef(code).plural}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (next: T) => void
}) {
  return (
    <div className="segmented" role="group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      className="check"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      &#10003;
    </button>
  )
}

export function ExpiryChip({ status, date }: { status: string; date: string | null }) {
  if (status === 'none' || !date) return null
  if (status === 'expired') return <span className="chip chip--danger">Expired</span>
  if (status === 'soon') return <span className="chip chip--warn">Use soon</span>
  return <span className="chip">Good</span>
}
