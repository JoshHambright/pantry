import { useEffect, useState } from 'react'
import type { FamilyRequest, Member, RequestKind } from '@pantry/shared'
import { api, ApiRequestError } from '../api.js'
import { Banner, Empty, Field, Segmented, Spinner } from '../components/ui.js'
import { relativeDay, todayIso } from '../lib/format.js'

export function Requests({ member, onChanged }: { member: Member; onChanged: () => void }) {
  const [requests, setRequests] = useState<FamilyRequest[] | null>(null)
  const [kind, setKind] = useState<RequestKind>('meal')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const today = todayIso()
  const isAdult = member.role === 'adult'

  useEffect(() => {
    api.requests
      .list()
      .then((result) => setRequests(result.requests))
      .catch(() => setError('Could not load requests'))
  }, [reload])

  const refresh = () => {
    setReload((current) => current + 1)
    onChanged()
  }

  const submit = async () => {
    if (!text.trim()) return
    setError(null)
    try {
      await api.requests.create({ kind, text: text.trim() })
      setText('')
      refresh()
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'Could not send that')
    }
  }

  const respond = async (request: FamilyRequest, status: FamilyRequest['status']) => {
    await api.requests.respond(request.id, { status }).catch(() => {})
    refresh()
  }

  if (!requests) return <Spinner />

  const open = requests.filter((request) => request.status === 'open')
  const answered = requests.filter((request) => request.status !== 'open')

  return (
    <>
      {error ? <Banner kind="error">{error}</Banner> : null}

      <div className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ marginBottom: 10 }}>Ask for something</h2>
        <div className="stack">
          <Segmented<RequestKind>
            value={kind}
            onChange={setKind}
            options={[
              { value: 'meal', label: 'A meal' },
              { value: 'grocery', label: 'Something to buy' },
            ]}
          />
          <Field label={kind === 'meal' ? 'What should we have?' : 'What should we get?'}>
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={kind === 'meal' ? 'Spaghetti please' : 'Strawberries'}
            />
          </Field>
          <button
            className="btn btn--primary btn--block"
            onClick={() => void submit()}
            disabled={!text.trim()}
          >
            Send it
          </button>
        </div>
      </div>

      <section className="section">
        <div className="section__head">
          <h2>Waiting</h2>
        </div>
        {open.length === 0 ? (
          <Empty icon={'\u{1F44C}'} title="Nothing waiting" />
        ) : (
          <ul className="list">
            {open.map((request) => (
              <li key={request.id} className="card" style={{ padding: 12 }}>
                <div className="row">
                  <span className="item__thumb" aria-hidden="true">
                    {request.kind === 'meal' ? '\u{1F37D}\u{FE0F}' : '\u{1F6D2}'}
                  </span>
                  <span className="grow truncate">
                    <span className="item__title">{request.text}</span>
                    <div className="muted">
                      {request.requestedByName} &middot;{' '}
                      {relativeDay(request.createdAt.slice(0, 10), today)}
                    </div>
                  </span>
                </div>
                <div className="row row--wrap" style={{ marginTop: 10 }}>
                  {isAdult ? (
                    <>
                      <button
                        className="btn btn--sm btn--primary grow"
                        onClick={() => void respond(request, 'approved')}
                      >
                        Yes
                      </button>
                      <button
                        className="btn btn--sm grow"
                        onClick={() => void respond(request, 'declined')}
                      >
                        Not this time
                      </button>
                    </>
                  ) : request.requestedById === member.id ? (
                    <button
                      className="btn btn--sm btn--ghost"
                      onClick={() => void api.requests.remove(request.id).then(refresh)}
                    >
                      Never mind
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {answered.length > 0 ? (
        <section className="section">
          <div className="section__head">
            <h2>Answered</h2>
          </div>
          <ul className="list">
            {answered.slice(0, 15).map((request) => (
              <li key={request.id} className="item item--flat">
                <span className="grow truncate">
                  <span className="item__title">{request.text}</span>
                  <div className="muted">{request.requestedByName}</div>
                </span>
                <span className={`chip chip--${request.status === 'approved' ? 'ok' : 'danger'}`}>
                  {request.status === 'approved' ? 'Yes' : 'No'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}
