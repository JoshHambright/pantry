import { useEffect, useState } from 'react'
import type { DashboardSummary, Member, StockRow } from '@pantry/shared'
import { api } from '../api.js'
import { Banner, Empty, Spinner } from '../components/ui.js'
import { CATEGORY_ICON, formatTotals, relativeDay, todayIso } from '../lib/format.js'
import type { Route } from '../App.js'

export function Dashboard({
  member,
  onNavigate,
  onChanged,
}: {
  member: Member
  onNavigate: (route: Route) => void
  onChanged: () => void
}) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const today = todayIso()

  useEffect(() => {
    api
      .dashboard()
      .then(setSummary)
      .catch(() => setError('Could not load the kitchen'))
  }, [])

  if (error) return <Banner kind="error">{error}</Banner>
  if (!summary) return <Spinner />

  const nothingUrgent =
    summary.expired.length === 0 &&
    summary.expiringSoon.length === 0 &&
    summary.lowStock.length === 0 &&
    summary.openRequests.length === 0

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        {greeting()}, {member.name}. {summary.productCount} things on hand, {summary.shoppingCount}{' '}
        on the list.
      </p>

      {summary.todaysMeals.length > 0 ? (
        <section className="section">
          <div className="section__head">
            <h2>Tonight</h2>
            <button className="btn btn--ghost btn--sm" onClick={() => onNavigate({ tab: 'meals' })}>
              Plan
            </button>
          </div>
          <ul className="list">
            {summary.todaysMeals.map((meal) => (
              <li key={meal.id} className="item item--flat">
                <span className="item__thumb" aria-hidden="true">
                  {'\u{1F37D}\u{FE0F}'}
                </span>
                <span className="grow">
                  <span className="item__title">{meal.recipeName ?? meal.customText}</span>
                  <div className="muted">{meal.slot}</div>
                </span>
                {meal.cookedAt ? <span className="chip chip--ok">Cooked</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {summary.expired.length > 0 ? (
        <StockSection
          title="Past its date"
          rows={summary.expired}
          tone="danger"
          onOpen={() => onNavigate({ tab: 'pantry' })}
        />
      ) : null}

      {summary.expiringSoon.length > 0 ? (
        <StockSection
          title="Use these soon"
          rows={summary.expiringSoon}
          tone="warn"
          onOpen={() => onNavigate({ tab: 'pantry' })}
        />
      ) : null}

      {summary.lowStock.length > 0 ? (
        <section className="section">
          <div className="section__head">
            <h2>Running low</h2>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => {
                void api.shopping.refill().then(onChanged)
              }}
            >
              Add to list
            </button>
          </div>
          <ul className="list">
            {summary.lowStock.map((row) => (
              <li key={row.product.id} className="item item--flat">
                <span className="item__thumb" aria-hidden="true">
                  {CATEGORY_ICON[row.product.category] ?? '\u{1F4E6}'}
                </span>
                <span className="grow truncate">
                  <span className="item__title">{row.product.name}</span>
                  <div className="muted">{formatTotals(row.totals)} left</div>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="section">
        <div className="section__head">
          <h2>Requests</h2>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => onNavigate({ tab: 'requests' })}
          >
            {summary.openRequests.length > 0 ? 'Answer' : 'Ask for something'}
          </button>
        </div>
        {summary.openRequests.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Nothing waiting.
          </p>
        ) : (
          <ul className="list">
            {summary.openRequests.map((request) => (
              <li key={request.id} className="item item--flat">
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
              </li>
            ))}
          </ul>
        )}
      </section>

      {nothingUrgent ? (
        <Empty
          icon={'\u{2728}'}
          title="The kitchen is in good shape"
          hint="Nothing needs you right now."
        />
      ) : null}
    </>
  )
}

function StockSection({
  title,
  rows,
  tone,
  onOpen,
}: {
  title: string
  rows: StockRow[]
  tone: 'warn' | 'danger'
  onOpen: () => void
}) {
  const today = todayIso()
  return (
    <section className="section">
      <div className="section__head">
        <h2>{title}</h2>
        <button className="btn btn--ghost btn--sm" onClick={onOpen}>
          Pantry
        </button>
      </div>
      <ul className="list">
        {rows.slice(0, 6).map((row) => (
          <li key={row.product.id} className="item item--flat">
            <span className="item__thumb" aria-hidden="true">
              {CATEGORY_ICON[row.product.category] ?? '\u{1F4E6}'}
            </span>
            <span className="grow truncate">
              <span className="item__title">{row.product.name}</span>
              <div className="muted">{formatTotals(row.totals)}</div>
            </span>
            {row.soonestExpiry ? (
              <span className={`chip chip--${tone}`}>{relativeDay(row.soonestExpiry, today)}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Morning'
  if (hour < 18) return 'Afternoon'
  return 'Evening'
}
