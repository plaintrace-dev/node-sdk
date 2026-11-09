/** How long one page held the visitor: time on screen, time interacting (each interaction
    counts five seconds), and the deepest scroll in percent. */
export interface EngagementSample {
  readonly active_ms: number
  readonly visible_ms: number
  readonly scroll_depth: number
}

const ACTIVE_WINDOW_MS = 5_000
const ACTIVITY = ['pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel'] as const

const defaultScroll = (win: Window) => () => {
  const h = win.document.documentElement.scrollHeight
  return h > 0 ? Math.min(100, Math.round(((win.scrollY + win.innerHeight) / h) * 100)) : 0
}

export function createEngagement(win: Window, now: () => number = () => performance.now(), measureScroll: () => number = defaultScroll(win)) {
  const doc = win.document
  let visibleSince: number | null = null
  let visible = 0
  let active = 0
  let activeStart: number | null = null
  let activeUntil = 0
  let deepest = 0
  let running = false
  const isVisible = () => doc.visibilityState !== 'hidden'

  const closeActive = (at: number) => {
    if (activeStart === null) return
    active += Math.max(0, Math.min(at, activeUntil) - activeStart)
    activeStart = null
  }
  const onActivity = () => {
    if (!running || !isVisible()) return
    const at = now()
    if (activeStart === null || at > activeUntil) {
      closeActive(at)
      activeStart = at
    }
    activeUntil = at + ACTIVE_WINDOW_MS
  }
  const onScroll = () => {
    deepest = Math.max(deepest, measureScroll())
  }
  const onVisibility = () => {
    const at = now()
    if (isVisible()) {
      if (visibleSince === null) visibleSince = at
      return
    }
    if (visibleSince !== null) visible += at - visibleSince
    visibleSince = null
    closeActive(at)
  }

  return {
    start(): void {
      running = true
      visibleSince = isVisible() ? now() : null
      for (const t of ACTIVITY) win.addEventListener(t, onActivity, { capture: true, passive: true })
      win.addEventListener('scroll', onScroll, { passive: true })
      doc.addEventListener('visibilitychange', onVisibility)
    },
    stop(): void {
      running = false
      for (const t of ACTIVITY) win.removeEventListener(t, onActivity, { capture: true })
      win.removeEventListener('scroll', onScroll)
      doc.removeEventListener('visibilitychange', onVisibility)
    },
    /** The page's totals so far, then zero for the next page; null when there is nothing. */
    collect(): EngagementSample | null {
      const at = now()
      if (visibleSince !== null) {
        visible += at - visibleSince
        visibleSince = at
      }
      const stillActive = activeStart !== null && at <= activeUntil
      closeActive(at)
      onScroll()
      const sample = { active_ms: Math.round(active), visible_ms: Math.round(visible), scroll_depth: deepest }
      active = 0
      visible = 0
      deepest = 0
      if (stillActive) activeStart = at
      return sample.active_ms === 0 && sample.visible_ms === 0 ? null : sample
    },
  }
}
