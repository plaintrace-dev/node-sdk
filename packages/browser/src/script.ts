import { createTracker, type Tracker, type TrackerOptions } from './core.js'
import { VERSION } from './version.js'

type Call = [method: string, ...args: unknown[]]
interface Stub {
  (...args: unknown[]): unknown
  q?: Call[]
  s?: 1
  __px?: true
  tracker?: Tracker
}

type Overrides = Partial<Omit<TrackerOptions, 'sdk' | 'version'>>

function fromScript(win: Window): Overrides {
  const doc = win.document
  const el = (doc.currentScript as HTMLScriptElement | null) ?? doc.querySelector<HTMLScriptElement>('script[data-site]')
  const attr = (n: string) => el?.getAttribute(n) ?? null
  const flag = (n: string) => {
    const v = attr(n)
    return v === null ? undefined : v !== 'false' && v !== '0'
  }
  const origin = el?.src ? new URL(el.src, win.location.href).origin : win.location.origin
  return {
    site: attr('data-site') ?? '',
    endpoint: attr('data-endpoint') ?? origin,
    requireConsent: flag('data-require-consent'),
    respectGpc: flag('data-respect-gpc'),
    respectDnt: flag('data-respect-dnt'),
    debug: flag('data-debug'),
    storage: attr('data-storage') === 'none' ? 'none' : 'auto',
    excludePaths: (attr('data-exclude-paths') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  }
}

/** Starts the tracker from the page's script tag (or overrides) and replaces the px() stub,
    applying the calls it queued. A window.px that belongs to another script is left alone. */
export function install(win: Window, overrides: Overrides = {}): Tracker | undefined {
  const w = win as unknown as Record<string, unknown>
  const existing = w['px'] as Stub | undefined
  if (existing?.__px) return existing.tracker
  const isStub = typeof existing === 'function' && existing.s === 1 && Array.isArray(existing.q)
  const foreign = existing !== undefined && existing !== null && !isStub
  const queued: Call[] = isStub ? (existing.q ?? []) : []

  const opts = { ...fromScript(win), ...stripUndefined(overrides) }
  if (!opts.site) {
    console.warn('[px] no data-site on the script tag; tracker not started')
    return undefined
  }
  // A function cannot travel in an attribute: px('pageUrl', fn) is read before the first page view.
  const pageUrl = queued.find((c) => c[0] === 'pageUrl')?.[1]
  // The npm package may have started one already: one tracker per page.
  const tracker =
    (w['__px_tracker'] as Tracker | undefined) ??
    createTracker({
      ...(opts as TrackerOptions),
      ...(typeof pageUrl === 'function' ? { pageUrl: pageUrl as TrackerOptions['pageUrl'] } : {}),
      sdk: 'web',
      version: VERSION,
      window: win,
    })
  w['__px_tracker'] = tracker

  const api: Stub = (method: unknown, ...args: unknown[]) => {
    const fn = (tracker as unknown as Record<string, unknown>)[String(method)]
    return typeof fn === 'function' ? (fn as (...a: unknown[]) => unknown).apply(tracker, args) : undefined
  }
  api.__px = true
  api.tracker = tracker
  for (const [method, ...args] of queued) if (method !== 'pageUrl') api(method, ...args)

  if (foreign) {
    w['pxAnalytics'] = api
    console.warn('[px] window.px belongs to another script; the tracker is window.pxAnalytics')
  } else w['px'] = api
  return tracker
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>
}
