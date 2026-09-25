import { useCallback, useEffect, useState } from 'react'
import type { Member, SessionInfo } from '@pantry/shared'
import { api, ApiRequestError } from './api.js'
import { Spinner } from './components/ui.js'
import { SignIn } from './screens/SignIn.js'
import { Dashboard } from './screens/Dashboard.js'
import { Inventory } from './screens/Inventory.js'
import { Scan } from './screens/Scan.js'
import { Shopping } from './screens/Shopping.js'
import { Meals } from './screens/Meals.js'
import { Requests } from './screens/Requests.js'
import { Settings } from './screens/Settings.js'
import { initials } from './lib/format.js'
import { useOnline } from './hooks/useOnline.js'

export type Tab = 'home' | 'scan' | 'pantry' | 'list' | 'meals'
export type Route = { tab: Tab } | { tab: 'requests' } | { tab: 'settings' }

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: '\u{1F3E0}' },
  { id: 'scan', label: 'Scan', icon: '\u{1F4F7}' },
  { id: 'pantry', label: 'Pantry', icon: '\u{1F9FA}' },
  { id: 'list', label: 'List', icon: '\u{1F4DD}' },
  { id: 'meals', label: 'Meals', icon: '\u{1F37D}\u{FE0F}' },
]

export function App() {
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [checking, setChecking] = useState(true)
  const [route, setRoute] = useState<Route>({ tab: 'home' })
  /** Bumped to make every screen reload without threading callbacks everywhere. */
  const [revision, setRevision] = useState(0)
  const online = useOnline()

  const refresh = useCallback(() => setRevision((current) => current + 1), [])

  const loadSession = useCallback(async () => {
    try {
      setSession(await api.auth.session())
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) setSession(null)
      else setSession(null)
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void loadSession()
  }, [loadSession])

  const signOut = useCallback(async () => {
    await api.auth.logout().catch(() => {})
    setSession(null)
    setRoute({ tab: 'home' })
  }, [])

  if (checking) {
    return (
      <div className="app">
        <main className="app__main">
          <Spinner label="Opening the pantry" />
        </main>
      </div>
    )
  }

  if (!session) {
    return <SignIn onSignedIn={() => void loadSession()} />
  }

  const member: Member = session.member
  const isAdult = member.role === 'adult'

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__title">
          <h1>{titleFor(route)}</h1>
          <span className="topbar__sub">{session.household.name}</span>
        </div>
        <button
          type="button"
          className="avatar"
          style={{ background: member.color }}
          onClick={() => setRoute({ tab: 'settings' })}
          aria-label={`Signed in as ${member.name}. Open settings.`}
        >
          {initials(member.name)}
        </button>
      </header>

      <main className="app__main">
        {online ? null : (
          <div className="banner banner--warn" role="status">
            Offline &mdash; showing the last data this phone saw. Changes will not save until
            you&rsquo;re back on the network.
          </div>
        )}
        {route.tab === 'home' ? (
          <Dashboard
            key={`home-${revision}`}
            member={member}
            onNavigate={setRoute}
            onChanged={refresh}
          />
        ) : null}
        {route.tab === 'scan' ? <Scan key={`scan-${revision}`} onChanged={refresh} /> : null}
        {route.tab === 'pantry' ? (
          <Inventory key={`pantry-${revision}`} isAdult={isAdult} onChanged={refresh} />
        ) : null}
        {route.tab === 'list' ? <Shopping key={`list-${revision}`} isAdult={isAdult} /> : null}
        {route.tab === 'meals' ? <Meals key={`meals-${revision}`} isAdult={isAdult} /> : null}
        {route.tab === 'requests' ? (
          <Requests key={`req-${revision}`} member={member} onChanged={refresh} />
        ) : null}
        {route.tab === 'settings' ? (
          <Settings
            member={member}
            household={session.household}
            onSignOut={() => void signOut()}
          />
        ) : null}
      </main>

      <nav className="tabbar" aria-label="Sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className="tabbar__item"
            aria-current={route.tab === tab.id ? 'page' : undefined}
            onClick={() => setRoute({ tab: tab.id })}
          >
            <span className="tabbar__icon" aria-hidden="true">
              {tab.icon}
            </span>
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

function titleFor(route: Route): string {
  switch (route.tab) {
    case 'home':
      return 'Kitchen'
    case 'scan':
      return 'Scan'
    case 'pantry':
      return 'Pantry'
    case 'list':
      return 'Shopping'
    case 'meals':
      return 'Meals'
    case 'requests':
      return 'Requests'
    case 'settings':
      return 'Settings'
  }
}
