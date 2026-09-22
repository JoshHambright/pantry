import { useEffect, useState } from 'react'
import { api, ApiRequestError } from '../api.js'
import { Banner, Field, Spinner } from '../components/ui.js'
import { initials } from '../lib/format.js'

interface Pickable {
  id: string
  name: string
  role: 'adult' | 'child'
  color: string
}

export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [members, setMembers] = useState<Pickable[] | null>(null)
  const [bootstrapped, setBootstrapped] = useState(true)
  const [chosen, setChosen] = useState<Pickable | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.auth
      .members()
      .then((result) => {
        setMembers(result.members)
        setBootstrapped(result.bootstrapped)
      })
      .catch(() => setError('Cannot reach the pantry server'))
  }, [])

  if (error && !members) {
    return (
      <div className="app">
        <main className="app__main">
          <Banner kind="error">{error}</Banner>
        </main>
      </div>
    )
  }

  if (!members) {
    return (
      <div className="app">
        <main className="app__main">
          <Spinner />
        </main>
      </div>
    )
  }

  if (!bootstrapped) return <FirstRun onDone={onSignedIn} />

  return (
    <div className="app">
      <main className="app__main">
        {chosen ? (
          <PinEntry member={chosen} onBack={() => setChosen(null)} onSignedIn={onSignedIn} />
        ) : (
          <>
            <h2 style={{ marginBottom: 14 }}>Who&rsquo;s this?</h2>
            <ul className="list">
              {members.map((member) => (
                <li key={member.id}>
                  <button type="button" className="item" onClick={() => setChosen(member)}>
                    <span
                      className="avatar"
                      style={{ background: member.color }}
                      aria-hidden="true"
                    >
                      {initials(member.name)}
                    </span>
                    <span className="grow">
                      <span className="item__title">{member.name}</span>
                      <div className="muted">{member.role === 'adult' ? 'Grown-up' : 'Kid'}</div>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  )
}

function PinEntry({
  member,
  onBack,
  onSignedIn,
}: {
  member: Pickable
  onBack: () => void
  onSignedIn: () => void
}) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (value: string) => {
    setBusy(true)
    setError(null)
    try {
      await api.auth.login({ memberId: member.id, pin: value })
      onSignedIn()
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'That did not work')
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  const press = (digit: string) => {
    if (busy) return
    const next = (pin + digit).slice(0, 8)
    setPin(next)
    // Four digits is the common case, so sign in without a separate tap.
    if (next.length === 4) void submit(next)
  }

  return (
    <>
      <div className="row row--between" style={{ marginBottom: 12 }}>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onBack}>
          &larr; Back
        </button>
        <strong>{member.name}</strong>
      </div>

      {error ? <Banner kind="error">{error}</Banner> : null}

      <div className="pindots" aria-label={`${pin.length} digits entered`}>
        {[0, 1, 2, 3].map((index) => (
          <span key={index} data-filled={pin.length > index} />
        ))}
      </div>

      <div className="pinpad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <button key={digit} type="button" onClick={() => press(digit)}>
            {digit}
          </button>
        ))}
        <button type="button" onClick={() => setPin('')} aria-label="Clear">
          &#10005;
        </button>
        <button type="button" onClick={() => press('0')}>
          0
        </button>
        <button
          type="button"
          onClick={() => void submit(pin)}
          disabled={pin.length < 4 || busy}
          aria-label="Sign in"
        >
          &rarr;
        </button>
      </div>
    </>
  )
}

/** First run: nothing exists yet, so this creates the household and first adult. */
function FirstRun({ onDone }: { onDone: () => void }) {
  const [householdName, setHouseholdName] = useState('')
  const [memberName, setMemberName] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.auth.bootstrap({ householdName, memberName, pin })
      onDone()
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'Could not set that up')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app">
      <main className="app__main">
        <h1 style={{ marginBottom: 6 }}>Set up your pantry</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          This runs on your own server. Nothing leaves the house except barcode lookups and photo
          scans.
        </p>

        {error ? <Banner kind="error">{error}</Banner> : null}

        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <Field label="What should we call the household?">
            <input
              value={householdName}
              onChange={(event) => setHouseholdName(event.target.value)}
              placeholder="The Hambrights"
              autoComplete="off"
              required
            />
          </Field>
          <Field label="Your name">
            <input
              value={memberName}
              onChange={(event) => setMemberName(event.target.value)}
              placeholder="Josh"
              autoComplete="off"
              required
            />
          </Field>
          <Field label="Pick a PIN" hint="4 to 8 digits. You can add everyone else afterwards.">
            <input
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
              inputMode="numeric"
              autoComplete="new-password"
              required
            />
          </Field>
          <button
            type="submit"
            className="btn btn--primary btn--lg btn--block"
            disabled={busy || pin.length < 4 || !householdName || !memberName}
          >
            {busy ? 'Setting up…' : 'Create pantry'}
          </button>
        </form>
      </main>
    </div>
  )
}
