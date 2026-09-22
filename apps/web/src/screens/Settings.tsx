import { useEffect, useState } from 'react'
import type { Location, Member } from '@pantry/shared'
import { STORAGE_KINDS } from '@pantry/shared'
import { api, ApiRequestError } from '../api.js'
import { Banner, Field, Sheet } from '../components/ui.js'
import { initials } from '../lib/format.js'

export function Settings({
  member,
  household,
  onSignOut,
}: {
  member: Member
  household: { id: string; name: string }
  onSignOut: () => void
}) {
  const [members, setMembers] = useState<Member[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [error, setError] = useState<string | null>(null)
  const [addingMember, setAddingMember] = useState(false)
  const [addingLocation, setAddingLocation] = useState(false)
  const [visionOn, setVisionOn] = useState<boolean | null>(null)
  const [reload, setReload] = useState(0)

  const isAdult = member.role === 'adult'

  useEffect(() => {
    void api.members.list().then((result) => setMembers(result.members))
    void api.locations.list().then((result) => setLocations(result.locations))
    void api.health().then((result) => setVisionOn(result.vision))
  }, [reload])

  const refresh = () => setReload((current) => current + 1)

  const remove = async (action: Promise<unknown>) => {
    try {
      await action
      refresh()
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'That did not work')
    }
  }

  return (
    <>
      {error ? <Banner kind="error">{error}</Banner> : null}

      <section className="section">
        <div className="section__head">
          <h2>Household</h2>
        </div>
        <div className="card">
          <div className="row">
            <span className="avatar" style={{ background: member.color }} aria-hidden="true">
              {initials(member.name)}
            </span>
            <span className="grow">
              <span className="item__title">{member.name}</span>
              <div className="muted">
                {household.name} &middot; {isAdult ? 'Grown-up' : 'Kid'}
              </div>
            </span>
          </div>
          <button className="btn btn--block" style={{ marginTop: 12 }} onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <h2>Everyone</h2>
          {isAdult ? (
            <button className="btn btn--ghost btn--sm" onClick={() => setAddingMember(true)}>
              + Add
            </button>
          ) : null}
        </div>
        <ul className="list">
          {members.map((entry) => (
            <li key={entry.id} className="item item--flat">
              <span className="avatar" style={{ background: entry.color }} aria-hidden="true">
                {initials(entry.name)}
              </span>
              <span className="grow">
                <span className="item__title">{entry.name}</span>
                <div className="muted">{entry.role === 'adult' ? 'Grown-up' : 'Kid'}</div>
              </span>
              {isAdult && entry.id !== member.id ? (
                <button
                  className="btn btn--ghost btn--sm"
                  aria-label={`Remove ${entry.name}`}
                  onClick={() => void remove(api.members.remove(entry.id))}
                >
                  &#10005;
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="section">
        <div className="section__head">
          <h2>Where things go</h2>
          {isAdult ? (
            <button className="btn btn--ghost btn--sm" onClick={() => setAddingLocation(true)}>
              + Add
            </button>
          ) : null}
        </div>
        <ul className="list">
          {locations.map((location) => (
            <li key={location.id} className="item item--flat">
              <span className="grow">
                <span className="item__title">{location.name}</span>
                <div className="muted">{location.kind}</div>
              </span>
              {isAdult ? (
                <button
                  className="btn btn--ghost btn--sm"
                  aria-label={`Remove ${location.name}`}
                  onClick={() => void remove(api.locations.remove(location.id))}
                >
                  &#10005;
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="section">
        <div className="section__head">
          <h2>Photo scanning</h2>
        </div>
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            {visionOn === null
              ? 'Checking…'
              : visionOn
                ? 'On. Photos are sent to Anthropic to be identified, and are not stored on the server.'
                : 'Off. Set ANTHROPIC_API_KEY on the server to turn it on.'}
          </p>
        </div>
      </section>

      {addingMember ? (
        <AddMemberSheet
          onClose={() => setAddingMember(false)}
          onAdded={() => {
            setAddingMember(false)
            refresh()
          }}
        />
      ) : null}

      {addingLocation ? (
        <AddLocationSheet
          onClose={() => setAddingLocation(false)}
          onAdded={() => {
            setAddingLocation(false)
            refresh()
          }}
        />
      ) : null}
    </>
  )
}

function AddMemberSheet({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState('')
  const [role, setRole] = useState<'adult' | 'child'>('child')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  return (
    <Sheet title="Add someone" onClose={onClose}>
      {error ? <Banner kind="error">{error}</Banner> : null}
      <div className="stack">
        <Field label="Name">
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Are they a grown-up?">
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as 'adult' | 'child')}
          >
            <option value="child">Kid &mdash; can ask for things</option>
            <option value="adult">Grown-up &mdash; can change everything</option>
          </select>
        </Field>
        <Field label="Their PIN" hint="4 to 8 digits.">
          <input
            value={pin}
            inputMode="numeric"
            onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
          />
        </Field>
        <button
          className="btn btn--primary btn--block"
          disabled={busy || !name.trim() || pin.length < 4}
          onClick={() => {
            setBusy(true)
            setError(null)
            api.members
              .create({ name: name.trim(), role, pin })
              .then(onAdded)
              .catch((caught: unknown) => {
                setError(caught instanceof ApiRequestError ? caught.message : 'Could not add them')
                setBusy(false)
              })
          }}
        >
          Add
        </button>
      </div>
    </Sheet>
  )
}

function AddLocationSheet({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Location['kind']>('pantry')
  const [error, setError] = useState<string | null>(null)

  return (
    <Sheet title="Add a place" onClose={onClose}>
      {error ? <Banner kind="error">{error}</Banner> : null}
      <div className="stack">
        <Field label="Name">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Garage freezer"
          />
        </Field>
        <Field label="What kind">
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as Location['kind'])}
          >
            {STORAGE_KINDS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <button
          className="btn btn--primary btn--block"
          disabled={!name.trim()}
          onClick={() => {
            setError(null)
            api.locations
              .create({ name: name.trim(), kind })
              .then(onAdded)
              .catch((caught: unknown) =>
                setError(caught instanceof ApiRequestError ? caught.message : 'Could not add that'),
              )
          }}
        >
          Add
        </button>
      </div>
    </Sheet>
  )
}
