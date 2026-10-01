import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import './App.css'

const MEMBERS_PER_PAGE = 20
const ONLINE_THRESHOLD_MINUTES = 5

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

  /* =========================================================
     DASHBOARD NAVIGATION
     ========================================================= */

  const [activeSection, setActiveSection] = useState('overview')

  /* =========================================================
     MEMBER ANALYTICS
     ========================================================= */

  const [members, setMembers] = useState([])
  const [presence, setPresence] = useState([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [membersError, setMembersError] = useState('')

  const [memberSearch, setMemberSearch] = useState('')
  const [memberStatusFilter, setMemberStatusFilter] =
    useState('all')

  const [memberPage, setMemberPage] = useState(1)

  const [selectedMember, setSelectedMember] =
    useState(null)

  /* =========================================================
     AUTH
     ========================================================= */

  useEffect(() => {
    checkUser()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, currentSession) => {
        setSession(currentSession)
      }
    )

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

    const isAdmin = await checkAdmin(
      currentSession.user.id
    )

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

    const { data, error } =
      await supabase.auth.signInWithPassword({
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
      setLoginError(
        'Unable to identify the logged-in user.'
      )

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
    setMembers([])
    setPresence([])
    setSelectedMember(null)
  }

  /* =========================================================
     LOAD ANALYTICS
     ========================================================= */

  async function loadAnalytics() {
    setLoading(true)
    setError('')

    const { data, error: databaseError } =
      await supabase
        .from('analytics_events')
        .select('*')
        .order('created_at', {
          ascending: false,
        })
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

    await loadMemberAnalytics()
  }

  /* =========================================================
     LOAD MEMBERS + PRESENCE
     ========================================================= */

  async function loadMemberAnalytics() {
    setMembersLoading(true)
    setMembersError('')

    try {
      const {
        data: memberData,
        error: memberError,
      } = await supabase
        .from('members')
        .select('id, name, user_id')
        .not('user_id', 'is', null)
        .order('name', {
          ascending: true,
        })

      if (memberError) {
        throw memberError
      }

      const {
        data: presenceData,
        error: presenceError,
      } = await supabase
        .from('member_presence')
        .select('user_id, last_seen_at')

      if (presenceError) {
        throw presenceError
      }

      setMembers(memberData || [])
      setPresence(presenceData || [])
    } catch (memberError) {
      console.error(
        'Member analytics error:',
        memberError
      )

      setMembersError(memberError.message)
      setMembers([])
      setPresence([])
    } finally {
      setMembersLoading(false)
    }
  }

  /* =========================================================
     PERIOD FILTER
     ========================================================= */

  const filteredEvents = useMemo(() => {
    if (period === 'all') {
      return events
    }

    const days = Number(period)

    const now = new Date()
    const startDate = new Date()

    startDate.setHours(0, 0, 0, 0)

    startDate.setDate(
      now.getDate() - (days - 1)
    )

    return events.filter((event) => {
      return (
        new Date(event.created_at) >= startDate
      )
    })
  }, [events, period])

  /* =========================================================
     STATISTICS
     ========================================================= */

  const statistics = useMemo(() => {
    const pageViewEvents =
      filteredEvents.filter(
        (event) =>
          event.event_type === 'page_view'
      )

    const uniqueSessions = new Set(
      filteredEvents
        .map((event) => event.session_id)
        .filter(Boolean)
    )

    const mobileEvents =
      filteredEvents.filter(
        (event) =>
          event.device_type === 'mobile'
      )

    const tabletEvents =
      filteredEvents.filter(
        (event) =>
          event.device_type === 'tablet'
      )

    const desktopEvents =
      filteredEvents.filter(
        (event) =>
          event.device_type === 'desktop'
      )

    const pwaEvents =
      filteredEvents.filter(
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

  /* =========================================================
     PAGE STATISTICS
     ========================================================= */

  const pageStatistics = useMemo(() => {
    const counts = {}

    filteredEvents
      .filter(
        (event) =>
          event.event_type === 'page_view'
      )
      .forEach((event) => {
        const page =
          event.page_path || '/'

        counts[page] =
          (counts[page] || 0) + 1
      })

    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
  }, [filteredEvents])

  /* =========================================================
     BROWSER STATISTICS
     ========================================================= */

  const browserStatistics = useMemo(() => {
    const counts = {}

    filteredEvents.forEach((event) => {
      const browser =
        event.browser || 'Unknown'

      counts[browser] =
        (counts[browser] || 0) + 1
    })

    return Object.entries(counts).sort(
      (a, b) => b[1] - a[1]
    )
  }, [filteredEvents])

  /* =========================================================
     OS STATISTICS
     ========================================================= */

  const operatingSystemStatistics =
    useMemo(() => {
      const counts = {}

      filteredEvents.forEach((event) => {
        const operatingSystem =
          event.operating_system ||
          'Unknown'

        counts[operatingSystem] =
          (counts[operatingSystem] || 0) + 1
      })

      return Object.entries(counts).sort(
        (a, b) => b[1] - a[1]
      )
    }, [filteredEvents])

  /* =========================================================
     DEVICE STATISTICS
     ========================================================= */

  const deviceStatistics = useMemo(() => {
    return [
      ['Desktop', statistics.desktop],
      ['Mobile', statistics.mobile],
      ['Tablet', statistics.tablet],
    ].filter((item) => item[1] > 0)
  }, [statistics])

  /* =========================================================
     DAILY STATISTICS
     ========================================================= */

  const dailyStatistics = useMemo(() => {
    const counts = {}

    filteredEvents
      .filter(
        (event) =>
          event.event_type === 'page_view'
      )
      .forEach((event) => {
        const date = new Date(
          event.created_at
        )

        const key = [
          date.getFullYear(),
          String(
            date.getMonth() + 1
          ).padStart(2, '0'),
          String(
            date.getDate()
          ).padStart(2, '0'),
        ].join('-')

        counts[key] =
          (counts[key] || 0) + 1
      })

    return Object.entries(counts)
      .sort((a, b) =>
        a[0].localeCompare(b[0])
      )
      .slice(-30)
  }, [filteredEvents])

  const maxDailyValue = Math.max(
    ...dailyStatistics.map(
      (item) => item[1]
    ),
    1
  )

  /* =========================================================
     MEMBER ANALYTICS
     ========================================================= */

  const memberAnalytics = useMemo(() => {
    const now = Date.now()

    return members.map((member) => {
      const memberPresence =
        presence.find(
          (item) =>
            item.user_id === member.user_id
        )

      const lastSeen =
        memberPresence?.last_seen_at || null

      const isOnline =
        lastSeen &&
        now -
          new Date(lastSeen).getTime() <=
          ONLINE_THRESHOLD_MINUTES *
            60 *
            1000

      const memberEvents =
        filteredEvents.filter(
          (event) =>
            event.user_id ===
            member.user_id
        )

      const pageVisits =
        memberEvents.filter(
          (event) =>
            event.event_type ===
            'page_view'
        )

      return {
        ...member,
        lastSeen,
        isOnline: Boolean(isOnline),
        pageVisits: pageVisits.length,
        events: memberEvents,
      }
    })
  }, [
    members,
    presence,
    filteredEvents,
  ])

  /* =========================================================
     MEMBER SEARCH + FILTER
     ========================================================= */

  const filteredMembers = useMemo(() => {
    const search =
      memberSearch.trim().toLowerCase()

    return memberAnalytics.filter(
      (member) => {
        const matchesSearch =
          !search ||
          (member.name || '')
            .toLowerCase()
            .includes(search)

        const matchesStatus =
          memberStatusFilter ===
            'all' ||
          (memberStatusFilter ===
            'online' &&
            member.isOnline) ||
          (memberStatusFilter ===
            'offline' &&
            !member.isOnline)

        return (
          matchesSearch &&
          matchesStatus
        )
      }
    )
  }, [
    memberAnalytics,
    memberSearch,
    memberStatusFilter,
  ])

  /* =========================================================
     MEMBER PAGINATION
     ========================================================= */

  const totalMemberPages = Math.max(
    1,
    Math.ceil(
      filteredMembers.length /
        MEMBERS_PER_PAGE
    )
  )

  useEffect(() => {
    if (memberPage > totalMemberPages) {
      setMemberPage(totalMemberPages)
    }
  }, [
    memberPage,
    totalMemberPages,
  ])

  useEffect(() => {
    setMemberPage(1)
  }, [
    memberSearch,
    memberStatusFilter,
  ])

  const paginatedMembers =
    useMemo(() => {
      const start =
        (memberPage - 1) *
        MEMBERS_PER_PAGE

      return filteredMembers.slice(
        start,
        start + MEMBERS_PER_PAGE
      )
    }, [
      filteredMembers,
      memberPage,
    ])

  const onlineMemberCount =
    memberAnalytics.filter(
      (member) => member.isOnline
    ).length

  const offlineMemberCount =
    memberAnalytics.length -
    onlineMemberCount

  /* =========================================================
     SELECTED MEMBER HISTORY
     ========================================================= */

  const selectedMemberAnalytics =
    useMemo(() => {
      if (!selectedMember) {
        return null
      }

      return (
        memberAnalytics.find(
          (member) =>
            member.user_id ===
            selectedMember.user_id
        ) || selectedMember
      )
    }, [
      selectedMember,
      memberAnalytics,
    ])

  const memberHistory =
    useMemo(() => {
      if (!selectedMemberAnalytics) {
        return []
      }

      return [
        ...(selectedMemberAnalytics.events ||
          []),
      ].sort(
        (a, b) =>
          new Date(b.created_at) -
          new Date(a.created_at)
      )
    }, [selectedMemberAnalytics])

  /* =========================================================
     FORMATTING
     ========================================================= */

  function formatDate(dateString) {
    if (!dateString) {
      return '-'
    }

    return new Date(
      dateString
    ).toLocaleString()
  }

  function formatDay(dateString) {
    const date = new Date(
      `${dateString}T00:00:00`
    )

    return date.toLocaleDateString(
      undefined,
      {
        day: '2-digit',
        month: 'short',
      }
    )
  }

  function getMemberInitial(name) {
    if (!name) {
      return '?'
    }

    return name
      .trim()
      .charAt(0)
      .toUpperCase()
  }

  function handleOpenMember(member) {
    setSelectedMember(member)
  }

  function handleBackToMembers() {
    setSelectedMember(null)
  }

  function handleOpenMembersSection() {
    setActiveSection('members')
    setSelectedMember(null)
  }

  /* =========================================================
     LOGIN CHECK
     ========================================================= */

  if (checkingAuth) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-logo">
            📊
          </div>

          <h1>
            Netaji Team Analytics
          </h1>

          <p>
            Checking administrator access...
          </p>
        </div>
      </div>
    )
  }

  /* =========================================================
     LOGIN PAGE
     ========================================================= */

  if (!session) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-logo">
            📊
          </div>

          <h1>
            Netaji Team Analytics
          </h1>

          <p className="login-subtitle">
            Private administrator dashboard
          </p>

          <form
            onSubmit={handleLogin}
          >
            <label>
              Email
            </label>

            <input
              type="email"
              placeholder="Admin email"
              value={email}
              onChange={(event) =>
                setEmail(
                  event.target.value
                )
              }
              required
            />

            <label>
              Password
            </label>

            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(event) =>
                setPassword(
                  event.target.value
                )
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

  /* =========================================================
     MAIN DASHBOARD
     ========================================================= */

  return (
    <div className="analytics-app">

      {/* HEADER */}

      <header className="analytics-header">
        <div className="header-brand">
          <div className="header-icon">
            📊
          </div>

          <div>
            <h1>
              Netaji Team Analytics
            </h1>

            <p>
              Private website analytics dashboard
            </p>
          </div>
        </div>

        <div className="header-actions">
          <button
            onClick={loadAnalytics}
          >
            🔄 Refresh
          </button>

          <button
            onClick={handleLogout}
          >
            🚪 Logout
          </button>
        </div>
      </header>

      {/* NAVIGATION */}

      <nav className="analytics-nav">
        <button
          className={
            activeSection ===
            'overview'
              ? 'nav-active'
              : ''
          }
          onClick={() => {
            setActiveSection(
              'overview'
            )
            setSelectedMember(null)
          }}
        >
          📊 Overview
        </button>

        <button
          className={
            activeSection ===
            'members'
              ? 'nav-active'
              : ''
          }
          onClick={
            handleOpenMembersSection
          }
        >
          👥 Team Members
          <span className="nav-count">
            {members.length}
          </span>
        </button>
      </nav>

      <main className="analytics-content">

        {/* =================================================
            OVERVIEW
            ================================================= */}

        {activeSection ===
          'overview' && (
          <>
            {/* PERIOD */}

            <section className="period-panel">
              <div>
                <h2>
                  Analytics Period
                </h2>

                <p>
                  Select the period you
                  want to analyze.
                </p>
              </div>

              <div className="period-buttons">

                <button
                  className={
                    period === '1'
                      ? 'active'
                      : ''
                  }
                  onClick={() =>
                    setPeriod('1')
                  }
                >
                  Today
                </button>

                <button
                  className={
                    period === '7'
                      ? 'active'
                      : ''
                  }
                  onClick={() =>
                    setPeriod('7')
                  }
                >
                  7 Days
                </button>

                <button
                  className={
                    period === '30'
                      ? 'active'
                      : ''
                  }
                  onClick={() =>
                    setPeriod('30')
                  }
                >
                  30 Days
                </button>

                <button
                  className={
                    period === 'all'
                      ? 'active'
                      : ''
                  }
                  onClick={() =>
                    setPeriod('all')
                  }
                >
                  All Time
                </button>

              </div>
            </section>

            {/* STATS */}

            <section className="stats-grid">

              <div className="stat-card">
                <span>
                  👥 Unique Visitors
                </span>

                <strong>
                  {
                    statistics.uniqueVisitors
                  }
                </strong>
              </div>

              <div className="stat-card">
                <span>
                  📄 Page Views
                </span>

                <strong>
                  {statistics.pageViews}
                </strong>
              </div>

              <div className="stat-card">
                <span>
                  🔗 Sessions
                </span>

                <strong>
                  {statistics.sessions}
                </strong>
              </div>

              <div className="stat-card">
                <span>
                  🔁 Returning Sessions
                </span>

                <strong>
                  {
                    statistics.returningSessions
                  }
                </strong>
              </div>

              <div className="stat-card">
                <span>
                  📱 Mobile Events
                </span>

                <strong>
                  {statistics.mobile}
                </strong>
              </div>

              <div className="stat-card">
                <span>
                  💻 Desktop Events
                </span>

                <strong>
                  {statistics.desktop}
                </strong>
              </div>

              <div className="stat-card">
                <span>
                  📲 PWA Events
                </span>

                <strong>
                  {statistics.pwa}
                </strong>
              </div>

              <div className="stat-card">
                <span>
                  ⚡ Total Events
                </span>

                <strong>
                  {statistics.totalEvents}
                </strong>
              </div>

            </section>

            {/* DAILY CHART */}

            <section className="analytics-panel">

              <div className="panel-header">
                <h2>
                  📈 Page Views by Day
                </h2>

                <p>
                  Daily page-view activity
                  for the selected period.
                </p>
              </div>

              {dailyStatistics.length ===
              0 ? (
                <div className="message">
                  No page-view data for
                  this period.
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
                          {formatDay(
                            date
                          )}
                        </div>
                      </div>
                    )
                  )}

                </div>
              )}

            </section>

            {/* PAGES + DEVICES */}

            <div className="two-column">

              <section className="analytics-panel">

                <div className="panel-header">
                  <h2>
                    📄 Popular Pages
                  </h2>

                  <p>
                    Most visited website
                    pages.
                  </p>
                </div>

                {pageStatistics.length ===
                0 ? (
                  <div className="message">
                    No page data
                    available.
                  </div>
                ) : (
                  <div className="ranking-list">

                    {pageStatistics.map(
                      (
                        [page, count],
                        index
                      ) => (
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

                          <strong>
                            {count}
                          </strong>
                        </div>
                      )
                    )}

                  </div>
                )}

              </section>

              <section className="analytics-panel">

                <div className="panel-header">
                  <h2>
                    💻 Devices
                  </h2>

                  <p>
                    Devices generating
                    analytics events.
                  </p>
                </div>

                {deviceStatistics.length ===
                0 ? (
                  <div className="message">
                    No device data
                    available.
                  </div>
                ) : (
                  <div className="ranking-list">

                    {deviceStatistics.map(
                      (
                        [device, count]
                      ) => (
                        <div
                          className="ranking-row"
                          key={device}
                        >
                          <span className="ranking-name">
                            {device}
                          </span>

                          <strong>
                            {count}
                          </strong>
                        </div>
                      )
                    )}

                  </div>
                )}

              </section>

            </div>

            {/* BROWSERS + OS */}

            <div className="two-column">

              <section className="analytics-panel">

                <div className="panel-header">
                  <h2>
                    🌐 Browsers
                  </h2>

                  <p>
                    Browsers used by
                    visitors.
                  </p>
                </div>

                <div className="ranking-list">

                  {browserStatistics.length ===
                  0 ? (
                    <div className="message">
                      No browser data
                      available.
                    </div>
                  ) : (
                    browserStatistics.map(
                      (
                        [browser, count]
                      ) => (
                        <div
                          className="ranking-row"
                          key={browser}
                        >
                          <span className="ranking-name">
                            {browser}
                          </span>

                          <strong>
                            {count}
                          </strong>
                        </div>
                      )
                    )
                  )}

                </div>

              </section>

              <section className="analytics-panel">

                <div className="panel-header">
                  <h2>
                    🖥️ Operating Systems
                  </h2>

                  <p>
                    Operating systems
                    used by visitors.
                  </p>
                </div>

                <div className="ranking-list">

                  {operatingSystemStatistics.length ===
                  0 ? (
                    <div className="message">
                      No operating system
                      data available.
                    </div>
                  ) : (
                    operatingSystemStatistics.map(
                      (
                        [
                          operatingSystem,
                          count,
                        ]
                      ) => (
                        <div
                          className="ranking-row"
                          key={
                            operatingSystem
                          }
                        >
                          <span className="ranking-name">
                            {
                              operatingSystem
                            }
                          </span>

                          <strong>
                            {count}
                          </strong>
                        </div>
                      )
                    )
                  )}

                </div>

              </section>

            </div>

            {/* RECENT ACTIVITY */}

            <section className="analytics-panel">

              <div className="panel-header">
                <h2>
                  🕒 Recent Activity
                </h2>

                <p>
                  Latest analytics events
                  received from the
                  Netaji Team website.
                </p>
              </div>

              {loading && (
                <div className="message">
                  Loading analytics...
                </div>
              )}

              {!loading && error && (
                <div className="error-message">
                  <strong>
                    Database error
                  </strong>

                  <br />

                  {error}
                </div>
              )}

              {!loading &&
                !error &&
                filteredEvents.length ===
                  0 && (
                  <div className="message">
                    No analytics data for
                    this period.
                  </div>
                )}

              {!loading &&
                !error &&
                filteredEvents.length >
                  0 && (
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
                            <tr
                              key={event.id}
                            >
                              <td>
                                {formatDate(
                                  event.created_at
                                )}
                              </td>

                              <td>
                                {
                                  event.event_type ||
                                  '-'
                                }
                              </td>

                              <td>
                                {
                                  event.page_path ||
                                  '-'
                                }
                              </td>

                              <td>
                                {
                                  event.device_type ||
                                  '-'
                                }
                              </td>

                              <td>
                                {
                                  event.browser ||
                                  '-'
                                }
                              </td>

                              <td>
                                {
                                  event.operating_system ||
                                  '-'
                                }
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
          </>
        )}

        {/* =================================================
            TEAM MEMBERS SECTION
            ================================================= */}

        {activeSection ===
          'members' && (
          <section className="members-section">

            {!selectedMember ? (
              <>
                {/* MEMBER HEADER */}

                <div className="members-page-header">

                  <div>
                    <h2>
                      👥 Team Members
                    </h2>

                    <p>
                      Monitor registered team
                      members and their website
                      activity.
                    </p>
                  </div>

                  <button
                    className="member-refresh-button"
                    onClick={
                      loadMemberAnalytics
                    }
                  >
                    🔄 Refresh Members
                  </button>

                </div>

                {/* MEMBER SUMMARY */}

                <div className="member-summary-grid">

                  <div className="member-summary-card">
                    <span>
                      👥 Registered Members
                    </span>

                    <strong>
                      {members.length}
                    </strong>
                  </div>

                  <div className="member-summary-card online">
                    <span>
                      🟢 Online
                    </span>

                    <strong>
                      {onlineMemberCount}
                    </strong>
                  </div>

                  <div className="member-summary-card offline">
                    <span>
                      ⚫ Offline
                    </span>

                    <strong>
                      {offlineMemberCount}
                    </strong>
                  </div>

                </div>

                {/* SEARCH + FILTER */}

                <div className="member-controls">

                  <div className="member-search-box">
                    <span>
                      🔎
                    </span>

                    <input
                      type="text"
                      placeholder="Search member by name..."
                      value={memberSearch}
                      onChange={(event) =>
                        setMemberSearch(
                          event.target.value
                        )
                      }
                    />
                  </div>

                  <div className="member-filter-buttons">

                    <button
                      className={
                        memberStatusFilter ===
                        'all'
                          ? 'active'
                          : ''
                      }
                      onClick={() =>
                        setMemberStatusFilter(
                          'all'
                        )
                      }
                    >
                      All
                    </button>

                    <button
                      className={
                        memberStatusFilter ===
                        'online'
                          ? 'active'
                          : ''
                      }
                      onClick={() =>
                        setMemberStatusFilter(
                          'online'
                        )
                      }
                    >
                      🟢 Online
                    </button>

                    <button
                      className={
                        memberStatusFilter ===
                        'offline'
                          ? 'active'
                          : ''
                      }
                      onClick={() =>
                        setMemberStatusFilter(
                          'offline'
                        )
                      }
                    >
                      ⚫ Offline
                    </button>

                  </div>

                </div>

                {/* ERROR */}

                {membersError && (
                  <div className="error-message">
                    <strong>
                      Member analytics error
                    </strong>

                    <br />

                    {membersError}
                  </div>
                )}

                {/* LOADING */}

                {membersLoading ? (
                  <div className="members-loading">
                    <div className="loading-spinner">
                      ⟳
                    </div>

                    <p>
                      Loading team members...
                    </p>
                  </div>
                ) : filteredMembers.length ===
                  0 ? (
                  <div className="message">
                    {memberSearch ||
                    memberStatusFilter !==
                      'all'
                      ? 'No members match your search or filter.'
                      : 'No registered members with accounts found.'}
                  </div>
                ) : (
                  <>
                    {/* MEMBER GRID */}

                    <div className="members-grid">

                      {paginatedMembers.map(
                        (member) => (
                          <button
                            className="member-card"
                            key={member.id}
                            onClick={() =>
                              handleOpenMember(
                                member
                              )
                            }
                          >

                            <div className="member-avatar">
                              {getMemberInitial(
                                member.name
                              )}
                            </div>

                            <div className="member-card-info">

                              <h3>
                                {member.name ||
                                  'Unnamed Member'}
                              </h3>

                              <div
                                className={
                                  member.isOnline
                                    ? 'member-status online'
                                    : 'member-status offline'
                                }
                              >
                                <span>
                                  {member.isOnline
                                    ? '🟢'
                                    : '⚫'}
                                </span>

                                {member.isOnline
                                  ? 'Online'
                                  : 'Offline'}
                              </div>

                            </div>

                            <div className="member-card-stats">

                              <div>
                                <span>
                                  Page Visits
                                </span>

                                <strong>
                                  {
                                    member.pageVisits
                                  }
                                </strong>
                              </div>

                              <div>
                                <span>
                                  Last Seen
                                </span>

                                <strong>
                                  {member.lastSeen
                                    ? formatDate(
                                        member.lastSeen
                                      )
                                    : 'Never'}
                                </strong>
                              </div>

                            </div>

                            <span className="member-arrow">
                              →
                            </span>

                          </button>
                        )
                      )}

                    </div>

                    {/* PAGINATION */}

                    <div className="pagination">

                      <button
                        disabled={
                          memberPage === 1
                        }
                        onClick={() =>
                          setMemberPage(
                            (page) =>
                              Math.max(
                                1,
                                page - 1
                              )
                          )
                        }
                      >
                        ← Previous
                      </button>

                      <div className="page-numbers">

                        {Array.from(
                          {
                            length:
                              totalMemberPages,
                          },
                          (_, index) =>
                            index + 1
                        )
                          .filter(
                            (page) => {
                              if (
                                totalMemberPages <=
                                7
                              ) {
                                return true
                              }

                              if (
                                page === 1 ||
                                page ===
                                  totalMemberPages
                              ) {
                                return true
                              }

                              return (
                                Math.abs(
                                  page -
                                    memberPage
                                ) <= 1
                              )
                            }
                          )
                          .map(
                            (page) => (
                              <button
                                key={page}
                                className={
                                  page ===
                                  memberPage
                                    ? 'active'
                                    : ''
                                }
                                onClick={() =>
                                  setMemberPage(
                                    page
                                  )
                                }
                              >
                                {page}
                              </button>
                            )
                          )}

                      </div>

                      <button
                        disabled={
                          memberPage ===
                          totalMemberPages
                        }
                        onClick={() =>
                          setMemberPage(
                            (page) =>
                              Math.min(
                                totalMemberPages,
                                page + 1
                              )
                          )
                        }
                      >
                        Next →
                      </button>

                    </div>

                    <div className="pagination-info">
                      Showing{' '}
                      {Math.min(
                        (memberPage - 1) *
                          MEMBERS_PER_PAGE +
                          1,
                        filteredMembers.length
                      )}{' '}
                      –{' '}
                      {Math.min(
                        memberPage *
                          MEMBERS_PER_PAGE,
                        filteredMembers.length
                      )}{' '}
                      of{' '}
                      {filteredMembers.length}{' '}
                      members
                    </div>
                  </>
                )}
              </>
            ) : (
              /* ===========================================
                 MEMBER DETAILS
                 =========================================== */

              <div className="member-details-page">

                <button
                  className="back-members-button"
                  onClick={
                    handleBackToMembers
                  }
                >
                  ← Back to Team Members
                </button>

                <div className="member-details-header">

                  <div className="member-details-avatar">
                    {getMemberInitial(
                      selectedMemberAnalytics?.name
                    )}
                  </div>

                  <div>

                    <h2>
                      {
                        selectedMemberAnalytics?.name ||
                        'Unnamed Member'
                      }
                    </h2>

                    <div
                      className={
                        selectedMemberAnalytics?.isOnline
                          ? 'member-status online'
                          : 'member-status offline'
                      }
                    >
                      <span>
                        {selectedMemberAnalytics?.isOnline
                          ? '🟢'
                          : '⚫'}
                      </span>

                      {selectedMemberAnalytics?.isOnline
                        ? 'Online'
                        : 'Offline'}
                    </div>

                  </div>

                </div>

                {/* MEMBER DETAIL CARDS */}

                <div className="member-detail-stats">

                  <div className="member-detail-card">
                    <span>
                      📄 Page Visits
                    </span>

                    <strong>
                      {
                        selectedMemberAnalytics
                          ?.pageVisits || 0
                      }
                    </strong>
                  </div>

                  <div className="member-detail-card">
                    <span>
                      🕒 Last Seen
                    </span>

                    <strong>
                      {selectedMemberAnalytics
                        ?.lastSeen
                        ? formatDate(
                            selectedMemberAnalytics.lastSeen
                          )
                        : 'Never'}
                    </strong>
                  </div>

                  <div className="member-detail-card">
                    <span>
                      📊 Total Events
                    </span>

                    <strong>
                      {
                        selectedMemberAnalytics
                          ?.events?.length || 0
                      }
                    </strong>
                  </div>

                </div>

                {/* HISTORY */}

                <section className="analytics-panel">

                  <div className="panel-header">

                    <h2>
                      🕒 Page Visit History
                    </h2>

                    <p>
                      Website activity recorded
                      for this team member.
                    </p>

                  </div>

                  {memberHistory.length ===
                  0 ? (
                    <div className="message">
                      No visit history found
                      for this member.
                    </div>
                  ) : (
                    <div className="table-container">

                      <table>

                        <thead>
                          <tr>
                            <th>
                              Date & Time
                            </th>

                            <th>
                              Event
                            </th>

                            <th>
                              Page
                            </th>

                            <th>
                              Device
                            </th>

                            <th>
                              Browser
                            </th>

                            <th>
                              OS
                            </th>

                            <th>
                              PWA
                            </th>
                          </tr>
                        </thead>

                        <tbody>

                          {memberHistory
                            .map(
                              (event) => (
                                <tr
                                  key={
                                    event.id
                                  }
                                >
                                  <td>
                                    {formatDate(
                                      event.created_at
                                    )}
                                  </td>

                                  <td>
                                    {
                                      event.event_type ||
                                      '-'
                                    }
                                  </td>

                                  <td>
                                    {
                                      event.page_path ||
                                      '/'
                                    }
                                  </td>

                                  <td>
                                    {
                                      event.device_type ||
                                      '-'
                                    }
                                  </td>

                                  <td>
                                    {
                                      event.browser ||
                                      '-'
                                    }
                                  </td>

                                  <td>
                                    {
                                      event.operating_system ||
                                      '-'
                                    }
                                  </td>

                                  <td>
                                    {event.is_pwa
                                      ? 'Yes'
                                      : 'No'}
                                  </td>
                                </tr>
                              )
                            )}

                        </tbody>

                      </table>

                    </div>
                  )}

                </section>

              </div>
            )}

          </section>
        )}

      </main>
    </div>
  )
}

export default App