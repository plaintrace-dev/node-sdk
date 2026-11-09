import { hostAllowed, loadConfig } from './config.js'
import { createEngagement } from './engagement.js'
import { watchNavigation, type NavKind } from './navigation.js'
import { applyIgnoreHash, createPrivacy, localStore, memoryStore, type Consent } from './privacy.js'
import { cleanProps, cleanTitle, cleanUrl, isValidName } from './sanitize.js'
import { createTransport, type OutEvent } from './transport.js'
import { uuidV7 } from './uuid.js'

const CONFIG_WAIT_MS = 3_000
const VISIT_IDLE_MS = 30 * 60_000
const USER_ID_MAX = 128

export interface TrackerOptions {
  readonly site: string
  /** The collector, or a first-party proxy path such as "/_i". */
  readonly endpoint: string
  readonly sdk: 'web' | 'web-npm'
  readonly version: string
  readonly requireConsent?: boolean
  readonly respectGpc?: boolean
  readonly respectDnt?: boolean
  /** "none" keeps even the consent answer and the owner's opt-out off the device. */
  readonly storage?: 'auto' | 'none'
  /** Paths never measured: exact, or a trailing "*" for a prefix. */
  readonly excludePaths?: readonly string[]
  /** Rewrites each address before it is recorded, e.g. ids into placeholders. */
  readonly pageUrl?: (href: string) => string
  /** Lets automated browsers send events and logs deliveries. */
  readonly debug?: boolean
  readonly window?: Window
  readonly fetchImpl?: typeof fetch
  readonly beaconImpl?: (url: string, body: string) => boolean
}

export interface Tracker {
  track(name: string, props?: Record<string, unknown>): void
  conversion(name: string, props?: Record<string, unknown>): void
  identify(userId: string): void
  /** Records a page view by hand, for routers the tracker cannot see. */
  pageview(): void
  consent(c: Consent): void
  /** The current visit's id for checkout metadata, or null before the collector answered,
      after 30 idle minutes, or while nothing may be measured. */
  visitId(): string | null
  flush(): void
  stop(): void
  readonly version: string
}

const excluded = (path: string, patterns: readonly string[]) =>
  patterns.some((p) => (p.endsWith('*') ? path.startsWith(p.slice(0, -1)) : path === p))

function inert(version: string): Tracker {
  const noop = () => {}
  return { track: noop, conversion: noop, identify: noop, pageview: noop, consent: noop, visitId: () => null, flush: noop, stop: noop, version }
}

export function createTracker(o: TrackerOptions): Tracker {
  const win = o.window ?? window
  const doc = win.document
  const now = () => Date.now()
  // WebDriver clients (Playwright, Puppeteer, Selenium, Lighthouse) are tests and scrapers.
  if ((win.navigator as Navigator & { webdriver?: boolean }).webdriver && !o.debug) return inert(o.version)

  const store = o.storage === 'none' ? memoryStore() : localStore()
  applyIgnoreHash(win, store)
  const privacy = createPrivacy(store, { requireConsent: o.requireConsent === true, respectGpc: o.respectGpc === true, respectDnt: o.respectDnt === true }, win.navigator)
  const endpoint = new URL(o.endpoint, win.location.href).href.replace(/\/+$/, '')
  const fetchImpl = o.fetchImpl ?? ((input, init) => win.fetch(input, init))
  const beaconImpl = o.beaconImpl ?? (typeof win.navigator.sendBeacon === 'function' ? (u: string, b: string) => win.navigator.sendBeacon(u, b) : undefined)

  let stopped = false
  let held = true
  let redactKeys: string[] = []
  let visit: { id: string; at: number } | null = null
  let lastEventAt = 0
  let lastPage: OutEvent['page'] | undefined
  let viewSent = false
  let warned = false

  const may = () => !stopped && privacy.mayCollect() && !excluded(win.location.pathname, o.excludePaths ?? [])
  const transport = createTransport({
    endpoint,
    site: o.site,
    sdk: { name: o.sdk, version: o.version },
    fetchImpl,
    beaconImpl,
    now,
    random: Math.random,
    schedule: (fn, ms) => {
      const t = win.setTimeout(fn, ms)
      return () => win.clearTimeout(t)
    },
    maySend: () => !stopped && privacy.mayCollect(),
    held: () => held,
    onVisit: (id) => (visit = { id, at: now() }),
    onDelivery: o.debug ? (events, problem) => console.info('[px]', problem ?? 'delivered', events) : undefined,
  })

  const page = (): OutEvent['page'] => {
    const href = win.location.href
    const url = cleanUrl(o.pageUrl ? o.pageUrl(href) : href, redactKeys)
    return doc.title ? { url, title: cleanTitle(doc.title) } : { url }
  }

  let nav: ReturnType<typeof watchNavigation> | undefined
  const emit = (e: Omit<OutEvent, 'event_id' | 'occurred_at'>, immediate = false) => {
    if (e.type !== 'page_view') nav?.settle()
    if (!may()) return
    lastEventAt = now()
    transport.enqueue({ event_id: uuidV7(), occurred_at: new Date(lastEventAt).toISOString(), page: page(), ...e }, immediate)
  }

  const engagement = createEngagement(win)
  const sendEngagement = () => {
    const sample = engagement.collect()
    if (sample && lastPage) emit({ type: 'engagement', page: lastPage, engagement: sample })
  }

  const onPage = (kind: NavKind) => {
    left = false
    if (kind === 'restore') engagement.collect() // the time before leaving went out at pagehide
    else sendEngagement()
    if (!may()) return
    const current = page()
    const referrer = viewSent ? lastPage?.url : cleanUrl(doc.referrer, redactKeys) || undefined
    emit({ type: 'page_view', navigation: kind, page: current, ...(referrer ? { referrer } : {}) }, true)
    lastPage = current
    viewSent = true
  }

  // pagehide and visibilitychange both fire on the way out, in either order: leave once,
  // until the page is visible again.
  let left = false
  const leave = () => {
    nav?.settle()
    if (left) return
    left = true
    sendEngagement()
    transport.flush(true)
  }
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') leave()
    else left = false
  }

  const stop = () => {
    if (stopped) return
    stopped = true
    nav?.stop()
    engagement.stop()
    doc.removeEventListener('visibilitychange', onVisibility)
    win.removeEventListener('pagehide', leave)
    transport.cancel()
  }

  const release = () => {
    if (!held) return
    held = false
    transport.flush()
  }
  const warn = (msg: string) => {
    if (!warned) console.warn(`[px] ${msg}`)
    warned = true
  }
  void loadConfig(endpoint, o.site, fetchImpl).then((c) => {
    if (stopped) return
    if (c === 'unknown_site') {
      warn('the collector does not know this site; nothing is sent')
      return stop()
    }
    if (c) {
      redactKeys = c.redactQueryKeys
      if (!hostAllowed(win.location.hostname, c.allowedDomains)) {
        warn(`${win.location.hostname} is not one of this site's domains; nothing is sent`)
        return stop()
      }
    }
    release()
  })
  win.setTimeout(release, CONFIG_WAIT_MS)

  engagement.start()
  doc.addEventListener('visibilitychange', onVisibility)
  win.addEventListener('pagehide', leave)
  nav = watchNavigation(win, onPage)

  return {
    track(name, props) {
      if (isValidName(name)) emit({ type: 'custom_event', name, props: cleanProps(props, redactKeys) })
    },
    conversion(name, props) {
      if (isValidName(name)) emit({ type: 'conversion', name, props: cleanProps(props, redactKeys) })
    },
    identify(userId) {
      if (typeof userId === 'string' && userId !== '') emit({ type: 'identify', external_user_id: userId.slice(0, USER_ID_MAX) })
    },
    pageview: () => onPage('soft'),
    consent(c) {
      privacy.setConsent(c)
      if (c === 'denied') transport.cancel()
      // The page the banner was shown on has not been counted yet.
      if (c === 'granted' && !viewSent) onPage('load')
    },
    visitId: () => (visit && may() && now() - lastEventAt < VISIT_IDLE_MS ? visit.id : null),
    flush: () => transport.flush(),
    stop,
    version: o.version,
  }
}
