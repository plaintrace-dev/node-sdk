/* Where each heatmap cell lands on the page as it is now. A cell whose element is gone (or has
   no size) is counted as unplaced and never drawn at a guessed position. */

export interface Cell {
  readonly selector: string
  readonly cx: number
  readonly cy: number
  readonly count: number
}

export interface Box {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface Placement {
  readonly points: { x: number; y: number; count: number }[]
  readonly placed: number
  readonly unplaced: number
  /** Selectors the page no longer has, most clicked first. */
  readonly missing: { selector: string; count: number }[]
}

/** cellSize: cell width in thousandths of the element's box (50 → 20×20 cells). boxOf gives page coordinates. */
export function place(cells: readonly Cell[], cellSize: number, boxOf: (selector: string) => Box | null): Placement {
  const boxes = new Map<string, Box | null>()
  const missing = new Map<string, number>()
  const points: Placement['points'] = []
  let placed = 0
  let unplaced = 0
  for (const c of cells) {
    if (!boxes.has(c.selector)) boxes.set(c.selector, boxOf(c.selector))
    const b = boxes.get(c.selector)
    if (!b || b.width <= 0 || b.height <= 0) {
      unplaced += c.count
      missing.set(c.selector, (missing.get(c.selector) ?? 0) + c.count)
      continue
    }
    // The cell's centre: (2·cx + 1)·cellSize / 2000 of the box.
    points.push({ x: b.left + ((2 * c.cx + 1) * cellSize * b.width) / 2000, y: b.top + ((2 * c.cy + 1) * cellSize * b.height) / 2000, count: c.count })
    placed += c.count
  }
  return { points, placed, unplaced, missing: [...missing].map(([selector, count]) => ({ selector, count })).sort((a, b) => b.count - a.count) }
}

export interface Data {
  views: number
  /** All clicks for this page and screen; the cells stop at the busiest 5,000. */
  total: number
  truncated: boolean
  small: boolean
  cell_size: number
  clicks: Cell[]
  elements: { selector: string; clicks: number; rage: number; dead: number }[]
  scroll_reach: number[]
}

const num = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min
}
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : [])

/** The API's answer, reduced to what the overlay draws: numbers are numbers, selectors strings, nothing else. */
export function parseData(raw: unknown): Data {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    views: num(r.views),
    total: num(r.total),
    truncated: r.truncated === true,
    small: r.small === true,
    cell_size: num(r.cell_size, 1, 1000) || 50,
    clicks: list(r.clicks)
      .filter((c) => typeof c.selector === 'string' && Number.isFinite(Number(c.count)) && Number(c.count) > 0)
      .map((c) => ({ selector: c.selector as string, cx: num(c.cx, 0, 19), cy: num(c.cy, 0, 19), count: num(c.count) })),
    elements: list(r.elements)
      .filter((e) => typeof e.selector === 'string')
      .map((e) => ({ selector: e.selector as string, clicks: num(e.clicks), rage: num(e.rage), dead: num(e.dead) })),
    scroll_reach: (Array.isArray(r.scroll_reach) ? r.scroll_reach : []).slice(0, 10).map((v) => num(v, 0, 1)),
  }
}
