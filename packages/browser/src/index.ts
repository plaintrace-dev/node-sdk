import { createTracker, type Tracker, type TrackerOptions } from './core.js'
import type { Consent } from './privacy.js'
import { VERSION } from './version.js'

export type { Tracker, TrackerOptions } from './core.js'
export type { Consent } from './privacy.js'

export type InitOptions = Omit<TrackerOptions, 'sdk' | 'version' | 'window'>

let instance: Tracker | undefined
let queue: ((t: Tracker) => void)[] = []

/** For tests and unusual hosts: init against a given window, or none (server rendering). */
export function initIn(win: Window | undefined, o: InitOptions): Tracker | undefined {
  if (!win) return undefined
  if (instance) return instance
  // One tracker per page, whichever of the script tag and this package starts first.
  const w = win as unknown as { __px_tracker?: Tracker }
  // A tracker the script tag started for this same site (stop() removes a stopped one).
  const shared = w.__px_tracker?.site === o.site ? w.__px_tracker : undefined
  instance = shared ?? createTracker({ ...o, sdk: 'web-npm', version: VERSION, window: win })
  w.__px_tracker = instance
  for (const call of queue.splice(0)) call(instance)
  return instance
}

/** Starts the tracker once and returns it; undefined during server rendering. */
export function init(o: InitOptions): Tracker | undefined {
  return initIn(typeof window === 'undefined' ? undefined : window, o)
}

// A server render never calls init: keep only the first calls, not one per request forever.
const MAX_EARLY_CALLS = 100
const later = (call: (t: Tracker) => void) => (instance ? call(instance) : void (queue.length < MAX_EARLY_CALLS && queue.push(call)))

export const track = (name: string, props?: Record<string, unknown>) => later((t) => t.track(name, props))
export const conversion = (name: string, props?: Record<string, unknown>) => later((t) => t.conversion(name, props))
export const identify = (userId: string) => later((t) => t.identify(userId))
export const consent = (c: Consent) => later((t) => t.consent(c))
export const visitId = (): string | null => instance?.visitId() ?? null
