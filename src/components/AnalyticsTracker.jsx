import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const APP_VERSION = '1.0.0'

function getDeviceType() {
  const width = window.innerWidth

  if (width <= 767) {
    return 'mobile'
  }

  if (width <= 1024) {
    return 'tablet'
  }

  return 'desktop'
}

function getBrowser() {
  const userAgent = navigator.userAgent

  if (userAgent.includes('Edg/')) return 'Edge'
  if (userAgent.includes('Chrome/')) return 'Chrome'
  if (userAgent.includes('Firefox/')) return 'Firefox'
  if (userAgent.includes('Safari/')) return 'Safari'
  if (userAgent.includes('OPR/')) return 'Opera'

  return 'Other'
}

function getOperatingSystem() {
  const userAgent = navigator.userAgent

  if (/Windows/i.test(userAgent)) return 'Windows'
  if (/Android/i.test(userAgent)) return 'Android'
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'iOS'
  if (/Mac/i.test(userAgent)) return 'macOS'
  if (/Linux/i.test(userAgent)) return 'Linux'

  return 'Other'
}

function getSessionId() {
  const STORAGE_KEY = 'netaji_analytics_session_id'

  let sessionId = sessionStorage.getItem(STORAGE_KEY)

  if (!sessionId) {
    sessionId =
      crypto.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(36).substring(2)}`

    sessionStorage.setItem(STORAGE_KEY, sessionId)
  }

  return sessionId
}

function isPWA() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

export default function AnalyticsTracker() {
  const location = useLocation()

  useEffect(() => {
    async function trackPageView() {
      try {
        const sessionId = getSessionId()

        const eventData = {
          session_id: sessionId,

          event_type: 'page_view',

          page_path:
            location.pathname + location.search,

          page_title: document.title,

          device_type: getDeviceType(),

          browser: getBrowser(),

          operating_system: getOperatingSystem(),

          country: null,

          region: null,

          city: null,

          app_version: APP_VERSION,

          is_pwa: isPWA(),
        }

        const { error } = await supabase
          .from('analytics_events')
          .insert(eventData)

        if (error) {
          console.error(
            'Analytics tracking error:',
            error
          )
        }
      } catch (error) {
        console.error(
          'Analytics tracker error:',
          error
        )
      }
    }

    trackPageView()
  }, [location.pathname, location.search])

  return null
}