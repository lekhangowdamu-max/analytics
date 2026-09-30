import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import './App.css'

function App() {
  const [session, setSession] = useState(null)
  const [checkingAuth, setCheckingAuth] = useState(true)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)

  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [period, setPeriod] = useState('7')

  useEffect(() => {
    checkUser()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  async function checkUser() {
    const {
      data: { session: currentSession },
    } = await supabase.auth.getSession()

    if (!currentSession) {
      setCheckingAuth(false)
      return
    }

    const isAdmin = await checkAdmin(currentSession.user.id)

    if (isAdmin) {
      setSession(currentSession)
      await loadAnalytics()
    }

    setCheckingAuth(false)
  }

  async function checkAdmin(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single()

    if (error || data?.role !== 'admin') {
      await supabase.auth.signOut()
      setSession(null)
      setLoginError(
        'Only registered administrators can access analytics.'
      )
      return false
    }

    return true
  }

  async function handleLogin(event) {
    event.preventDefault()

    setLoginError('')
    setLoggingIn(true)

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setLoginError(error.message)
      setLoggingIn(false)
      return
    }

    const userId = data.user?.id

    if (!userId) {
      setLoginError('Unable to identify the logged-in user.')
      setLoggingIn(false)
      return
    }

    const isAdmin = await checkAdmin(userId)

    if (!isAdmin) {
      setLoginError(
        'Access denied. Only admins can use analytics.'
      )
      setLoggingIn(false)
      return
    }

    setSession(data.session)
    setLoggingIn(false)

    await loadAnalytics()
  }

  async function handleLogout() {
    await supabase.auth.signOut()

    setSession(null)
    setEvents([])
  }

  async function loadAnalytics() {
    setLoading(true)
    setError('')

    const { data, error: databaseError } = await supabase
      .from('analytics_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5000)

    if (databaseError) {
      console.error(
        'Analytics database error:',
        databaseError
      )

      setError(databaseError.message)
      setEvents([])
    } else {
      setEvents(data || [])
    }

    setLoading(false)
  }

  const filteredEvents = useMemo(() => {
    if (period === 'all') {
      return events
    }

    const days = Number(period)

    const now = new Date()
    const startDate = new Date()

    startDate.setHours(0, 0, 0, 0)
    startDate.setDate(now.getDate() - (days - 1))

    return events.filter((event) => {
      return new Date(event.created_at) >= startDate
    })
  }, [events, period])

  const statistics = useMemo(() => {
    const pageViewEvents = filteredEvents.filter(
      (event) => event.event_type === 'page_view'
    )

    const uniqueSessions = new Set(
      filteredEvents
        .map((event) => event.session_id)
        .filter(Boolean)
    )

    const mobileEvents = filteredEvents.filter(
      (event) => event.device_type === 'mobile'
    )

    const tabletEvents = filteredEvents.filter(
      (event) => event.device_type === 'tablet'
    )

    const desktopEvents = filteredEvents.filter(
      (event) => event.device_type === 'desktop'
    )

    const pwaEvents = filteredEvents.filter(
      (event) => event.is_pwa === true
    )

    const returningSessions = (() => {
      const counts = {}

      filteredEvents.forEach((event) => {
        if (!event.session_id) return

        counts[event.session_id] =
          (counts[event.session_id] || 0) + 1
      })

      return Object.values(counts).filter(
        (count) => count > 1
      ).length
    })()

    return {
      totalEvents: filteredEvents.length,
      pageViews: pageViewEvents.length,
      uniqueVisitors: uniqueSessions.size,
      sessions: uniqueSessions.size,
      returningSessions,
      mobile: mobileEvents.length,
      tablet: tabletEvents.length,
      desktop: desktopEvents.length,
      pwa: pwaEvents.length,
    }
  }, [filteredEvents])

  const pageStatistics = useMemo(() => {
    const counts = {}

    filteredEvents
      .filter(
        (event) => event.event_type === 'page_view'
      )
      .forEach((event) => {
        const page = event.page_path || '/'

        counts[page] = (counts[page] || 0) + 1
      })

    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
  }, [filteredEvents])

  const browserStatistics = useMemo(() => {
    const counts = {}

    filteredEvents.forEach((event) => {
      const browser = event.browser || 'Unknown'

      counts[browser] = (counts[browser] || 0) + 1
    })

    return Object.entries(counts).sort(
      (a, b) => b[1] - a[1]
    )
  }, [filteredEvents])

  const operatingSystemStatistics = useMemo(() => {
    const counts = {}

    filteredEvents.forEach((event) => {
      const operatingSystem =
        event.operating_system || 'Unknown'

      counts[operatingSystem] =
        (counts[operatingSystem] || 0) + 1
    })

    return Object.entries(counts).sort(
      (a, b) => b[1] - a[1]
    )
  }, [filteredEvents])

  const deviceStatistics = useMemo(() => {
    return [
      ['Desktop', statistics.desktop],
      ['Mobile', statistics.mobile],
      ['Tablet', statistics.tablet],
    ].filter((item) => item[1] > 0)
  }, [statistics])

  const dailyStatistics = useMemo(() => {
    const counts = {}

    filteredEvents
      .filter(
        (event) => event.event_type === 'page_view'
      )
      .forEach((event) => {
        const date = new Date(event.created_at)

        const key = [
          date.getFullYear(),
          String(date.getMonth() + 1).padStart(2, '0'),
          String(date.getDate()).padStart(2, '0'),
        ].join('-')

        counts[key] = (counts[key] || 0) + 1
      })

    return Object.entries(counts)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-30)
  }, [filteredEvents])

  const maxDailyValue = Math.max(
    ...dailyStatistics.map((item) => item[1]),
    1
  )

  function formatDate(dateString) {
    return new Date(dateString).toLocaleString()
  }

  function formatDay(dateString) {
    const date = new Date(
      `${dateString}T00:00:00`
    )

    return date.toLocaleDateString(undefined, {
      day: '2-digit',
      month: 'short',
    })
  }

  if (checkingAuth) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-logo">📊</div>

          <h1>Netaji Team Analytics</h1>

          <p>Checking administrator access...</p>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-logo">📊</div>

          <h1>Netaji Team Analytics</h1>

          <p className="login-subtitle">
            Private administrator dashboard
          </p>

          <form onSubmit={handleLogin}>
            <label>Email</label>

            <input
              type="email"
              placeholder="Admin email"
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
              required
            />

            <label>Password</label>

            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
              required
            />

            {loginError && (
              <div className="login-error">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={loggingIn}
            >
              {loggingIn
                ? 'Signing in...'
                : '🔐 Admin Login'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="analytics-app">

      <header className="analytics-header">
        <div className="header-brand">
          <div className="header-icon">📊</div>

          <div>
            <h1>Netaji Team Analytics</h1>

            <p>
              Private website analytics dashboard
            </p>
          </div>
        </div>

        <div className="header-actions">
          <button onClick={loadAnalytics}>
            🔄 Refresh
          </button>

          <button onClick={handleLogout}>
            🚪 Logout
          </button>
        </div>
      </header>

      <main className="analytics-content">

        <section className="period-panel">
          <div>
            <h2>Analytics Period</h2>

            <p>
              Select the period you want to analyze.
            </p>
          </div>

          <div className="period-buttons">

            <button
              className={
                period === '1' ? 'active' : ''
              }
              onClick={() => setPeriod('1')}
            >
              Today
            </button>

            <button
              className={
                period === '7' ? 'active' : ''
              }
              onClick={() => setPeriod('7')}
            >
              7 Days
            </button>

            <button
              className={
                period === '30' ? 'active' : ''
              }
              onClick={() => setPeriod('30')}
            >
              30 Days
            </button>

            <button
              className={
                period === 'all' ? 'active' : ''
              }
              onClick={() => setPeriod('all')}
            >
              All Time
            </button>

          </div>
        </section>

        <section className="stats-grid">

          <div className="stat-card">
            <span>👥 Unique Visitors</span>
            <strong>
              {statistics.uniqueVisitors}
            </strong>
          </div>

          <div className="stat-card">
            <span>📄 Page Views</span>
            <strong>
              {statistics.pageViews}
            </strong>
          </div>

          <div className="stat-card">
            <span>🔗 Sessions</span>
            <strong>
              {statistics.sessions}
            </strong>
          </div>

          <div className="stat-card">
            <span>🔁 Returning Sessions</span>
            <strong>
              {statistics.returningSessions}
            </strong>
          </div>

          <div className="stat-card">
            <span>📱 Mobile Events</span>
            <strong>
              {statistics.mobile}
            </strong>
          </div>

          <div className="stat-card">
            <span>💻 Desktop Events</span>
            <strong>
              {statistics.desktop}
            </strong>
          </div>

          <div className="stat-card">
            <span>📲 PWA Events</span>
            <strong>
              {statistics.pwa}
            </strong>
          </div>

          <div className="stat-card">
            <span>⚡ Total Events</span>
            <strong>
              {statistics.totalEvents}
            </strong>
          </div>

        </section>

        <section className="analytics-panel">

          <div className="panel-header">
            <h2>📈 Page Views by Day</h2>

            <p>
              Daily page-view activity for the
              selected period.
            </p>
          </div>

          {dailyStatistics.length === 0 ? (
            <div className="message">
              No page-view data for this period.
            </div>
          ) : (
            <div className="chart">

              {dailyStatistics.map(
                ([date, value]) => (
                  <div
                    className="chart-column"
                    key={date}
                  >
                    <div className="chart-value">
                      {value}
                    </div>

                    <div
                      className="chart-bar"
                      style={{
                        height: `${Math.max(
                          (value /
                            maxDailyValue) *
                            180,
                          8
                        )}px`,
                      }}
                    />

                    <div className="chart-label">
                      {formatDay(date)}
                    </div>
                  </div>
                )
              )}

            </div>
          )}

        </section>

        <div className="two-column">

          <section className="analytics-panel">

            <div className="panel-header">
              <h2>📄 Popular Pages</h2>

              <p>
                Most visited website pages.
              </p>
            </div>

            {pageStatistics.length === 0 ? (
              <div className="message">
                No page data available.
              </div>
            ) : (
              <div className="ranking-list">

                {pageStatistics.map(
                  ([page, count], index) => (
                    <div
                      className="ranking-row"
                      key={page}
                    >
                      <span className="ranking-number">
                        {index + 1}
                      </span>

                      <span className="ranking-name">
                        {page}
                      </span>

                      <strong>{count}</strong>
                    </div>
                  )
                )}

              </div>
            )}

          </section>

          <section className="analytics-panel">

            <div className="panel-header">
              <h2>💻 Devices</h2>

              <p>
                Devices generating analytics events.
              </p>
            </div>

            {deviceStatistics.length === 0 ? (
              <div className="message">
                No device data available.
              </div>
            ) : (
              <div className="ranking-list">

                {deviceStatistics.map(
                  ([device, count]) => (
                    <div
                      className="ranking-row"
                      key={device}
                    >
                      <span className="ranking-name">
                        {device}
                      </span>

                      <strong>{count}</strong>
                    </div>
                  )
                )}

              </div>
            )}

          </section>

        </div>

        <div className="two-column">

          <section className="analytics-panel">

            <div className="panel-header">
              <h2>🌐 Browsers</h2>

              <p>
                Browsers used by visitors.
              </p>
            </div>

            <div className="ranking-list">

              {browserStatistics.length === 0 ? (
                <div className="message">
                  No browser data available.
                </div>
              ) : (
                browserStatistics.map(
                  ([browser, count]) => (
                    <div
                      className="ranking-row"
                      key={browser}
                    >
                      <span className="ranking-name">
                        {browser}
                      </span>

                      <strong>{count}</strong>
                    </div>
                  )
                )
              )}

            </div>

          </section>

          <section className="analytics-panel">

            <div className="panel-header">
              <h2>🖥️ Operating Systems</h2>

              <p>
                Operating systems used by visitors.
              </p>
            </div>

            <div className="ranking-list">

              {operatingSystemStatistics.length ===
              0 ? (
                <div className="message">
                  No operating system data
                  available.
                </div>
              ) : (
                operatingSystemStatistics.map(
                  ([operatingSystem, count]) => (
                    <div
                      className="ranking-row"
                      key={operatingSystem}
                    >
                      <span className="ranking-name">
                        {operatingSystem}
                      </span>

                      <strong>{count}</strong>
                    </div>
                  )
                )
              )}

            </div>

          </section>

        </div>

        <section className="analytics-panel">

          <div className="panel-header">
            <h2>🕒 Recent Activity</h2>

            <p>
              Latest analytics events received from
              the Netaji Team website.
            </p>
          </div>

          {loading && (
            <div className="message">
              Loading analytics...
            </div>
          )}

          {!loading && error && (
            <div className="error-message">
              <strong>Database error</strong>
              <br />
              {error}
            </div>
          )}

          {!loading &&
            !error &&
            filteredEvents.length === 0 && (
              <div className="message">
                No analytics data for this period.
              </div>
            )}

          {!loading &&
            !error &&
            filteredEvents.length > 0 && (
              <div className="table-container">

                <table>

                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Event</th>
                      <th>Page</th>
                      <th>Device</th>
                      <th>Browser</th>
                      <th>OS</th>
                      <th>PWA</th>
                    </tr>
                  </thead>

                  <tbody>

                    {filteredEvents
                      .slice(0, 100)
                      .map((event) => (
                        <tr key={event.id}>

                          <td>
                            {formatDate(
                              event.created_at
                            )}
                          </td>

                          <td>
                            {event.event_type || '-'}
                          </td>

                          <td>
                            {event.page_path || '-'}
                          </td>

                          <td>
                            {event.device_type || '-'}
                          </td>

                          <td>
                            {event.browser || '-'}
                          </td>

                          <td>
                            {event.operating_system ||
                              '-'}
                          </td>

                          <td>
                            {event.is_pwa
                              ? 'Yes'
                              : 'No'}
                          </td>

                        </tr>
                      ))}

                  </tbody>

                </table>

              </div>
            )}

        </section>

      </main>
    </div>
  )
}

export default App