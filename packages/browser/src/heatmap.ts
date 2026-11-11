import { selectorFor } from './selector.js'

/* Heatmap clicks: which element, where in its box (0–1000 on each axis), on what screen size,
   and whether it was a rage click (the visitor hammering one spot) or a dead click (nothing
   happened). Never the text clicked on, never a field's value. */

const RAGE_MS = 700
const RAGE_PX = 30
const RAGE_COUNT = 3
const DEAD_MS = 1_000
const MAX_PER_PAGE = 50
// Clicks here are never recorded: passwords, card fields, and anything the site marks.
const SENSITIVE = 'input[type=password],[autocomplete^="cc-"],[data-pt-ignore]'

export type Viewport = 'desktop' | 'tablet' | 'mobile'

export interface ClickRecord {
  readonly page: { readonly url: string; readonly title?: string }
  /** The address path when clicked, for excluded paths. */
  readonly path: string
  readonly click: { readonly selector: string; readonly x: number; readonly y: number; readonly viewport: Viewport; readonly rage: boolean; readonly dead: boolean }
}

export const viewportOf = (width: number): Viewport => (width < 768 ? 'mobile' : width < 1024 ? 'tablet' : 'desktop')

const within = (v: number, start: number, size: number) => (size > 0 ? Math.max(0, Math.min(1000, Math.round(((v - start) / size) * 1000))) : 500)

/** Listens for clicks; each is reported a second later, once it is known whether it was dead. */
export function createClicks(win: Window, report: (r: ClickRecord) => void, pageOf: () => ClickRecord['page'] = () => ({ url: win.location.href })) {
  const doc = win.document
  let count = 0
  const recent: { t: number; x: number; y: number }[] = []
  const pending = new Set<{ fire(dead: boolean): void; drop(): void }>()

  const onClick = (e: MouseEvent) => {
    if (!e.isTrusted || count >= MAX_PER_PAGE) return
    const el = e.target as Element | null
    if (!el || el.nodeType !== 1 || el.closest(SENSITIVE)) return
    count++
    const now = Date.now()
    while (recent.length > 0 && now - recent[0]!.t > RAGE_MS) recent.shift()
    const near = recent.filter((r) => Math.hypot(r.x - e.clientX, r.y - e.clientY) <= RAGE_PX).length
    recent.push({ t: now, x: e.clientX, y: e.clientY })
    const box = el.getBoundingClientRect()
    const base = {
      page: pageOf(),
      path: win.location.pathname,
      click: {
        selector: selectorFor(el),
        x: within(e.clientX, box.left, box.width),
        y: within(e.clientY, box.top, box.height),
        viewport: viewportOf(win.innerWidth),
        rage: near + 1 >= RAGE_COUNT,
      },
    }
    // Dead: in the next second the address, the page and the focus all stayed as they were.
    const href = win.location.href
    const focus = doc.activeElement
    let changed = false
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(() => (changed = true)) : null
    observer?.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
    const entry = {
      fire(dead: boolean) {
        if (!pending.delete(entry)) return
        win.clearTimeout(timer)
        observer?.disconnect()
        report({ ...base, click: { ...base.click, dead } })
      },
      drop() {
        pending.delete(entry)
        win.clearTimeout(timer)
        observer?.disconnect()
      },
    }
    const timer = win.setTimeout(() => entry.fire(!changed && win.location.href === href && doc.activeElement === focus), DEAD_MS)
    pending.add(entry)
  }
  doc.addEventListener('click', onClick, true)

  return {
    /** A new page view: up to 50 clicks again. */
    newPage() {
      count = 0
    },
    /** The page is going away: what is still waiting goes now (not known to be dead). */
    flushPending() {
      for (const p of [...pending]) p.fire(false)
    },
    stop() {
      doc.removeEventListener('click', onClick, true)
      for (const p of [...pending]) p.drop()
    },
  }
}
