import { hostAllowed, loadConfig } from './config.js'
import { createEngagement } from './engagement.js'
import { createClicks } from './heatmap.js'
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

/** "#pt-heatmap=<token>&api=<dashboard API>" in the address: taken out of it at once so it is
    never shared or recorded. Null when absent, or when the API is not https (or localhost). */
function overlayLink(win: Window): { token: string; api: string } | null {
  const hash = win.location.hash
  const raw = hash.match(/(?:^#|&)pt-heatmap=([^&]*)/)?.[1]
  if (raw === undefined) return null
  win.history.replaceState(win.history.state, '', win.location.pathname + win.location.search)
  // <site uuid>.<expiry ms>.<base64url HMAC-SHA256>, as the API issues it.
  const token = /^[0-9a-f-]{36}\.\d{10,16}\.[\w-]{43}$/.test(raw) ? raw : null
  if (!token) return null
  try {
    const api = new URL(decodeURIComponent(hash.match(/(?:^#|&)api=([^&]+)/)?.[1] ?? ''))
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(api.hostname)
    return api.protocol === 'https:' || (api.protocol === 'http:' && local) ? { token, api: api.origin } : null
  } catch {
    return null
  }
}

function openOverlay(win: Window, endpoint: string, version: string, link: { token: string; api: string }) {
  ;(win as unknown as { __ptOverlay?: typeof link }).__ptOverlay = link
  const s = win.document.createElement('script')
  s.async = true
  s.src = new URL(`${endpoint.replace(/\/+$/, '')}/v/${version}/overlay.js`, win.location.href).href
  win.document.head.appendChild(s)
}

export function createTracker(o: TrackerOptions): Tracker {
  const win = o.window ?? window
  const doc = win.document
  const now = () => Date.now()
  // The owner opened their page from the dashboard's heatmap: show it, measure nothing.
  const overlay = overlayLink(win)
  if (overlay) {
    // Only the site's own dashboard: a crafted link naming another API opens nothing.
    const endpoint = new URL(o.endpoint, win.location.href).href.replace(/\/+$/, '')
    void loadConfig(endpoint, o.site, o.fetchImpl ?? ((input, init) => win.fetch(input, init))).then((c) => {
      if (c && c !== 'unknown_site' && c.appOrigin !== '' && c.appOrigin === overlay.api) openOverlay(win, o.endpoint, o.version, overlay)
    })
    return inert(o.version)
  }
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
  let lastPath = ''
  let viewSent = false
  // How the latest page not yet counted was reached: consent given later counts it as that.
  let unsentKind: NavKind = 'load'
  let warned = false

  const may = (path = win.location.pathname) => !stopped && privacy.mayCollect() && !excluded(path, o.excludePaths ?? [])
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

  const page = (): NonNullable<OutEvent['page']> => {
    const href = win.location.href
    const url = cleanUrl(o.pageUrl ? o.pageUrl(href) : href, redactKeys)
    return doc.title ? { url, title: cleanTitle(doc.title) } : { url }
  }

  let nav: ReturnType<typeof watchNavigation> | undefined
  /** path: the address the event belongs to, when it is not the current one. */
  const emit = (e: Omit<OutEvent, 'event_id' | 'occurred_at'>, immediate = false, path?: string) => {
    if (e.type !== 'page_view') nav?.settle()
    if (!may(path)) return
    // The collector does not extend a visit for clicks: neither may the visit id here.
    if (e.type !== 'click') lastEventAt = now()
    transport.enqueue({ event_id: uuidV7(), occurred_at: new Date(lastEventAt).toISOString(), page: page(), ...e }, immediate)
  }

  const engagement = createEngagement(win)
  let clicks: ReturnType<typeof createClicks> | undefined
  const sendEngagement = () => {
    const sample = engagement.collect()
    // The page being left: the address may already be the next page's.
    if (sample && lastPage) emit({ type: 'engagement', page: lastPage, engagement: sample }, false, lastPath)
  }

  const onPage = (kind: NavKind) => {
    left = false
    clicks?.newPage()
    if (kind === 'restore') engagement.collect() // the time before leaving went out at pagehide
    else sendEngagement()
    if (!may()) {
      // Nothing of an unmeasured page is kept: its time is not credited to the page before it.
      lastPage = undefined
      unsentKind = kind
      return
    }
    const current = page()
    const referrer = viewSent ? lastPage?.url : cleanUrl(doc.referrer, redactKeys) || undefined
    // On the way out the exit beacon carries it; a separate fetch could be cut off.
    emit({ type: 'page_view', navigation: kind, page: current, ...(referrer ? { referrer } : {}) }, !exiting)
    lastPage = current
    lastPath = win.location.pathname
    viewSent = true
  }

  // pagehide and visibilitychange both fire on the way out, in either order: leave once,
  // until the page is visible again.
  let left = false
  let exiting = false
  const leave = () => {
    exiting = true
    try {
      nav?.settle()
    } finally {
      exiting = false
    }
    if (left) return
    left = true
    sendEngagement()
    clicks?.flushPending()
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
    clicks?.stop()
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
      // The page and path are taken at the click: an SPA may move on before the click is reported.
      if (c.heatmaps) clicks = createClicks(win, (r) => emit({ type: 'click', page: r.page, click: r.click }, false, r.path), page)
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
      // While prerendering, the page is counted when it is shown (prerenderingchange), not now.
      if (c === 'granted' && !viewSent && !(doc as Document & { prerendering?: boolean }).prerendering) onPage(unsentKind)
    },
    visitId: () => (visit && may() && now() - lastEventAt < VISIT_IDLE_MS ? visit.id : null),
    flush: () => transport.flush(),
    stop,
    version: o.version,
  }
}
