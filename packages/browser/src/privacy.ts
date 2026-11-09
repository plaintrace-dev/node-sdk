export type Consent = 'granted' | 'denied' | 'unknown'

export interface Store {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

const CONSENT = 'px.consent'
const IGNORE = 'px.ignore'

export function memoryStore(): Store {
  const m = new Map<string, string>()
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) }
}

/** localStorage when it works; memory when it is blocked, full or throws (private windows, sandboxes). */
export function localStore(): Store {
  let ls: Storage | null = null
  try {
    ls = window.localStorage
  } catch {}
  if (!ls) return memoryStore()
  let fallback: Store | null = null
  return {
    get: (k) => {
      if (fallback) return fallback.get(k)
      try {
        return ls!.getItem(k)
      } catch {
        return null
      }
    },
    set: (k, v) => {
      if (fallback) return fallback.set(k, v)
      try {
        ls!.setItem(k, v)
      } catch {
        fallback = memoryStore()
        fallback.set(k, v)
      }
    },
    remove: (k) => {
      if (fallback) return fallback.remove(k)
      try {
        ls!.removeItem(k)
      } catch {}
    },
  }
}

export interface Policy {
  readonly requireConsent: boolean
  readonly respectGpc: boolean
  readonly respectDnt: boolean
}

/** Decides whether anything may be measured; only the consent answer and the owner's opt-out are kept. */
export function createPrivacy(store: Store, policy: Policy, nav: Navigator) {
  const consent = (): Consent => {
    const c = store.get(CONSENT)
    return c === 'granted' || c === 'denied' ? c : 'unknown'
  }
  const n = nav as Navigator & { globalPrivacyControl?: boolean; doNotTrack?: string | null }
  return {
    mayCollect(): boolean {
      const c = consent()
      if (c === 'denied') return false
      if (policy.respectGpc && n.globalPrivacyControl === true) return false
      if (policy.respectDnt && (n.doNotTrack === '1' || n.doNotTrack === 'yes')) return false
      if (policy.requireConsent && c !== 'granted') return false
      return store.get(IGNORE) !== '1'
    },
    setConsent(c: Consent): void {
      if (c === 'unknown') store.remove(CONSENT)
      else store.set(CONSENT, c)
    },
    ignored: (): boolean => store.get(IGNORE) === '1',
  }
}

/** The owner opts their own browser out with #px-ignore (back in with #px-unignore); the hash
    then leaves the address so it is not shared or bookmarked. */
export function applyIgnoreHash(win: Window, store: Store): 'ignored' | 'unignored' | null {
  const hash = win.location.hash
  let changed: 'ignored' | 'unignored' | null = null
  if (hash === '#px-ignore') {
    store.set(IGNORE, '1')
    changed = 'ignored'
  } else if (hash === '#px-unignore') {
    store.remove(IGNORE)
    changed = 'unignored'
  }
  if (changed) win.history.replaceState(win.history.state, '', win.location.pathname + win.location.search)
  return changed
}
