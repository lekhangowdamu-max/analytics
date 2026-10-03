import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import './App.css'

const MEMBERS_PER_PAGE = 20
const ONLINE_THRESHOLD_MINUTES = 5
const EVENTS_PAGE_SIZE = 1000

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

  const [activeSection, setActiveSection] = useState('overview')

  const [members, setMembers] = useState([])
  const [presence, setPresence] = useState([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [membersError, setMembersError] = useState('')

  const [memberSearch, setMemberSearch] = useState('')
  const [memberStatusFilter, setMemberStatusFilter] = useState('all')
  const [memberPage, setMemberPage] = useState(1)
  const [selectedMember, setSelectedMember] = useState(null)

  useEffect(() => {
    checkUser()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession)
    })

    return () => subscription.unsubscribe()
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
      setLoginError('Only registered administrators can access analytics.')
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
      setLoginError('Access denied. Only admins can use analytics.')
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
     LOAD ALL ANALYTICS EVENTS
     ========================================================= */

  async function loadAnalytics() {
    setLoading(true)
    setError('')

    try {
      const allEvents = []
      let from = 0

      while (true) {
        const to = from + EVENTS_PAGE_SIZE - 1

        const { data, error: databaseError } = await supabase
          .from('analytics_events')
          .select('*')
          .order('created_at', { ascending: false })
          .range(from, to)

        if (databaseError) throw databaseError

        allEvents.push(...(data || []))

        if (!data || data.length < EVENTS_PAGE_SIZE) break

        from += EVENTS_PAGE_SIZE
      }

      setEvents(allEvents)
    } catch (databaseError) {
      console.error('Analytics database error:', databaseError)
      setError(databaseError.message)
      setEvents([])
    } finally {
      setLoading(false)
    }

    await loadMemberAnalytics()
  }

  /* =========================================================
     LOAD MEMBERS + PRESENCE
     ========================================================= */

  async function loadMemberAnalytics() {
    setMembersLoading(true)
    setMembersError('')

    try {
      const { data: memberData, error: memberError } = await supabase
        .from('members')
        .select('id, name, user_id')
        .not('user_id', 'is', null)
        .order('name', { ascending: true })

      if (memberError) throw memberError

      const { data: presenceData, error: presenceError } = await supabase
        .from('member_presence')
        .select('user_id, last_seen_at')

      if (presenceError) throw presenceError

      setMembers(memberData || [])
      setPresence(presenceData || [])
    } catch (memberError) {
      console.error('Member analytics error:', memberError)
      setMembersError(memberError.message)
      setMembers([])
      setPresence([])
    } finally {
      setMembersLoading(false)
    }
  }

  /* =========================================================
     ALL-TIME WEBSITE STATISTICS
     ========================================================= */

  const statistics = useMemo(() => {
    const pageViewEvents = events.filter(
      (event) => event.event_type === 'page_view'
    )

    const sessionMap = new Map()

    events.forEach((event) => {
      const sessionId = event.session_id || `event-${event.id}`

      if (!sessionMap.has(sessionId)) {
        sessionMap.set(sessionId, {
          hasMember: false,
        })
      }

      if (event.user_id) {
        sessionMap.get(sessionId).hasMember = true
      }
    })

    const totalVisitors = sessionMap.size

    const memberUserIds = new Set(
      members.map((member) => member.user_id).filter(Boolean)
    )

    const visitedMemberIds = new Set(
      events
        .map((event) => event.user_id)
        .filter((userId) => userId && memberUserIds.has(userId))
    )

    const installedMemberIds = new Set(
      events
        .filter((event) => event.is_pwa === true && event.user_id)
        .map((event) => event.user_id)
        .filter((userId) => memberUserIds.has(userId))
    )

    // Unique PWA sessions where no registered member account was identified.
    // This represents non-member visitors using the installed PWA.
    const installedGuestSessionIds = new Set(
      events
        .filter((event) => event.is_pwa === true && !event.user_id)
        .map((event) => event.session_id)
        .filter(Boolean)
    )

    const guestVisitors = [...sessionMap.values()].filter(
      (sessionInfo) => !sessionInfo.hasMember
    ).length

    return {
      totalVisitors,
      membersVisited: visitedMemberIds.size,
      guestVisitors,
      membersInstalled: installedMemberIds.size,
      guestInstalled: installedGuestSessionIds.size,
      totalPageVisits: pageViewEvents.length,
    }
  }, [events, members])

  /* =========================================================
     PAGE VISITS
     ========================================================= */

  const pageStatistics = useMemo(() => {
    const counts = {}

    events
      .filter((event) => event.event_type === 'page_view')
      .forEach((event) => {
        const page = event.page_path || '/'
        counts[page] = (counts[page] || 0) + 1
      })

    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [events])

  function getPageLabel(path) {
    const labels = {
      '/': '🏠 Home',
      '/home': '🏠 Home',
      '/members': '👥 Members',
      '/gallery': '🖼️ Gallery / Photos',
      '/contact': '📞 Contact',
      '/login': '🔐 Login',
      '/admin': '👨‍💼 Admin Dashboard',
    }

    return labels[path] || path
  }

  const trackingStartedAt = useMemo(() => {
    if (!events.length) return null

    return events.reduce((earliest, event) => {
      if (!event.created_at) return earliest
      if (!earliest) return event.created_at
      return new Date(event.created_at) < new Date(earliest)
        ? event.created_at
        : earliest
    }, null)
  }, [events])

  /* =========================================================
     MEMBER ANALYTICS
     ========================================================= */

  const memberAnalytics = useMemo(() => {
    const now = Date.now()

    return members.map((member) => {
      const memberPresence = presence.find(
        (item) => item.user_id === member.user_id
      )

      const lastSeen = memberPresence?.last_seen_at || null

      const isOnline =
        lastSeen &&
        now - new Date(lastSeen).getTime() <=
          ONLINE_THRESHOLD_MINUTES * 60 * 1000

      const memberEvents = events.filter(
        (event) => event.user_id === member.user_id
      )

      const pageVisits = memberEvents.filter(
        (event) => event.event_type === 'page_view'
      )

      return {
        ...member,
        lastSeen,
        isOnline: Boolean(isOnline),
        pageVisits: pageVisits.length,
        events: memberEvents,
      }
    })
  }, [members, presence, events])

  const filteredMembers = useMemo(() => {
    const search = memberSearch.trim().toLowerCase()

    return memberAnalytics.filter((member) => {
      const matchesSearch =
        !search || (member.name || '').toLowerCase().includes(search)

      const matchesStatus =
        memberStatusFilter === 'all' ||
        (memberStatusFilter === 'online' && member.isOnline) ||
        (memberStatusFilter === 'offline' && !member.isOnline)

      return matchesSearch && matchesStatus
    })
  }, [memberAnalytics, memberSearch, memberStatusFilter])

  const totalMemberPages = Math.max(
    1,
    Math.ceil(filteredMembers.length / MEMBERS_PER_PAGE)
  )

  useEffect(() => {
    if (memberPage > totalMemberPages) {
      setMemberPage(totalMemberPages)
    }
  }, [memberPage, totalMemberPages])

  useEffect(() => {
    setMemberPage(1)
  }, [memberSearch, memberStatusFilter])

  const paginatedMembers = useMemo(() => {
    const start = (memberPage - 1) * MEMBERS_PER_PAGE
    return filteredMembers.slice(start, start + MEMBERS_PER_PAGE)
  }, [filteredMembers, memberPage])

  const onlineMemberCount = memberAnalytics.filter(
    (member) => member.isOnline
  ).length

  const offlineMemberCount = memberAnalytics.length - onlineMemberCount

  const selectedMemberAnalytics = useMemo(() => {
    if (!selectedMember) return null

    return (
      memberAnalytics.find(
        (member) => member.user_id === selectedMember.user_id
      ) || selectedMember
    )
  }, [selectedMember, memberAnalytics])

  const memberHistory = useMemo(() => {
    if (!selectedMemberAnalytics) return []

    return [...(selectedMemberAnalytics.events || [])].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    )
  }, [selectedMemberAnalytics])

  /* =========================================================
     FORMATTING + NAVIGATION
     ========================================================= */

  function formatDate(dateString) {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleString()
  }

  function formatTrackingDate(dateString) {
    if (!dateString) return '-'

    return new Date(dateString).toLocaleDateString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  }

  function getMemberInitial(name) {
    if (!name) return '?'
    return name.trim().charAt(0).toUpperCase()
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
          <p className="login-subtitle">Private administrator dashboard</p>

          <form onSubmit={handleLogin}>
            <label>Email</label>
            <input
              type="email"
              placeholder="Admin email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />

            <label>Password</label>
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />

            {loginError && <div className="login-error">{loginError}</div>}

            <button type="submit" disabled={loggingIn}>
              {loggingIn ? 'Signing in...' : '🔐 Admin Login'}
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
            <p>Website visitor and member analytics</p>
          </div>
        </div>

        <div className="header-actions">
          <button onClick={loadAnalytics}>🔄 Refresh</button>
          <button onClick={handleLogout}>🚪 Logout</button>
        </div>
      </header>

      <nav className="analytics-nav">
        <button
          className={activeSection === 'overview' ? 'nav-active' : ''}
          onClick={() => {
            setActiveSection('overview')
            setSelectedMember(null)
          }}
        >
          📊 Overview
        </button>

        <button
          className={activeSection === 'members' ? 'nav-active' : ''}
          onClick={handleOpenMembersSection}
        >
          👥 Team Members
          <span className="nav-count">{members.length}</span>
        </button>
      </nav>

      <main className="analytics-content">
        {activeSection === 'overview' && (
          <>
            <section className="tracking-summary">
              <div>
                <h2>📈 Website Overview</h2>
                <p>
                  All-time analytics collected from the deployed Netaji Team website.
                </p>
              </div>

              <div className="tracking-meta">
                <span>Tracking since</span>
                <strong>{formatTrackingDate(trackingStartedAt)}</strong>
              </div>
            </section>

            {loading && (
              <div className="message">Loading all website analytics...</div>
            )}

            {!loading && error && (
              <div className="error-message">
                <strong>Database error</strong>
                <br />
                {error}
              </div>
            )}

            {!loading && !error && (
              <>
                <section className="stats-grid simple-stats-grid">
                  <div className="stat-card">
                    <span>👥 Total Visitors</span>
                    <strong>{statistics.totalVisitors}</strong>
                    <small>Unique visitor sessions</small>
                  </div>

                  <div className="stat-card">
                    <span>👤 Members Visited</span>
                    <strong>{statistics.membersVisited}</strong>
                    <small>Registered members</small>
                  </div>

                  <div className="stat-card">
                    <span>🌐 Guest Visitors</span>
                    <strong>{statistics.guestVisitors}</strong>
                    <small>Visitors without member login</small>
                  </div>

                  <div className="stat-card">
                    <span>📱 Members Installed</span>
                    <strong>{statistics.membersInstalled}</strong>
                    <small>Registered members using the installed PWA</small>
                  </div>

                  <div className="stat-card">
                    <span>🌐 Guest App Users</span>
                    <strong>{statistics.guestInstalled}</strong>
                    <small>Non-members using the installed PWA</small>
                  </div>
                </section>

                <section className="analytics-panel page-visits-panel">
                  <div className="panel-header">
                    <h2>📄 Page Visits</h2>
                    <p>
                      Total visits to each page since analytics tracking started.
                    </p>
                  </div>

                  <div className="page-total-banner">
                    <span>Total page visits</span>
                    <strong>{statistics.totalPageVisits}</strong>
                  </div>

                  {pageStatistics.length === 0 ? (
                    <div className="message">No page visits recorded yet.</div>
                  ) : (
                    <div className="ranking-list page-ranking-list">
                      {pageStatistics.map(([page, count], index) => (
                        <div className="ranking-row" key={page}>
                          <span className="ranking-number">{index + 1}</span>
                          <span className="ranking-name">{getPageLabel(page)}</span>
                          <strong>{count}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="analytics-panel analytics-note-panel">
                  <div className="panel-header">
                    <h2>ℹ️ How these numbers are counted</h2>
                  </div>
                  <div className="analytics-notes">
                    <p>
                      <strong>Total Visitors</strong> counts unique visitor sessions recorded by the website.
                    </p>
                    <p>
                      <strong>Members Visited</strong> counts registered members whose user account appears in the analytics events.
                    </p>
                    <p>
                      <strong>Guest Visitors</strong> counts visitor sessions where no registered member account was identified.
                    </p>
                    <p>
                      <strong>Members Installed</strong> counts unique registered members who generated an analytics event while using the installed PWA.
                    </p>
                    <p>
                      <strong>Guest App Users</strong> counts unique PWA sessions where no registered member account was identified.
                    </p>
                  </div>
                </section>
              </>
            )}
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
