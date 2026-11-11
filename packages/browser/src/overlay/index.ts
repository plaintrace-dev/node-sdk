import { storedPath } from '../sanitize.js'
import { resolve } from '../selector.js'
import { viewportOf, type Viewport } from '../heatmap.js'
import { parseData, place, type Box, type Data } from './place.js'

/* The heatmap overlay, loaded only when the owner opens a page from the dashboard. It draws on
   the live page, never stores a picture of it, and says how much of the data it could not place. */


type Layer = 'clicks' | 'rage' | 'dead' | 'scroll'


function start({ token, api }: { token: string; api: string }) {
  const doc = document
  const host = doc.createElement('pt-heatmap')
  host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483646;pointer-events:none'
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `<canvas part="heat"></canvas><div class="marks"></div><aside class="panel" role="dialog" aria-label="Heatmap">
    <header><strong>Heatmap</strong><span class="path"></span><button class="close" aria-label="Close heatmap">×</button></header>
    <div class="row"><label>Screen <select class="vp"><option value="desktop">Desktop</option><option value="tablet">Tablet</option><option value="mobile">Mobile</option></select></label></div>
    <div class="row layers">${(['clicks', 'rage', 'dead', 'scroll'] as Layer[]).map((l) => `<label><input type="checkbox" value="${l}" checked> ${l[0]!.toUpperCase() + l.slice(1)}</label>`).join('')}</div>
    <div class="stats" aria-live="polite">Loading…</div>
  </aside>`
  // A constructed stylesheet is not inline CSS: a site's strict style-src does not block it.
  if ('adoptedStyleSheets' in root && typeof CSSStyleSheet === 'function' && 'replaceSync' in CSSStyleSheet.prototype) {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(CSS)
    root.adoptedStyleSheets = [sheet]
  } else {
    const style = doc.createElement('style')
    style.textContent = CSS
    root.prepend(style)
  }
  doc.body.appendChild(host)
  const $ = <T extends Element>(s: string) => root.querySelector(s) as T
  const canvas = $<HTMLCanvasElement>('canvas')
  const marks = $<HTMLDivElement>('.marks')
  const stats = $<HTMLDivElement>('.stats')
  const vp = $<HTMLSelectElement>('.vp')
  vp.value = viewportOf(innerWidth)
  const layers = new Set<Layer>(['clicks', 'rage', 'dead', 'scroll'])
  let data: Data | null = null
  // The path as it was recorded (ids as :id, segments decoded), not the raw address.
  let path = storedPath(location.pathname)
  let timer = 0

  const pageBox = (selector: string): Box | null => {
    const el = resolve(selector, doc)
    if (!el || host.contains(el)) return null
    const r = el.getBoundingClientRect()
    return { left: r.left + scrollX, top: r.top + scrollY, width: r.width, height: r.height }
  }

  const draw = () => {
    marks.textContent = ''
    const W = doc.documentElement.scrollWidth
    const H = doc.documentElement.scrollHeight
    // Very tall or wide pages are drawn at a lower resolution: browsers cap a canvas's height
    // and its area (Safari: 16.7 M pixels).
    const k = Math.min(1, 16_000 / H, Math.sqrt(16_000_000 / (W * H)))
    canvas.width = Math.round(W * k)
    canvas.height = Math.round(H * k)
    canvas.style.cssText = `position:absolute;top:0;left:0;width:${W}px;height:${H}px`
    const ctx = canvas.getContext('2d')
    if (!ctx || !data) return
    const p = place(data.clicks, data.cell_size, pageBox)
    if (layers.has('clicks')) heat(ctx, p.points, k)
    if (layers.has('scroll')) scrollBand(W, H)
    for (const e of data.elements) {
      const kinds = (['rage', 'dead'] as const).filter((t) => layers.has(t) && e[t] > 0)
      const b = kinds.length > 0 ? pageBox(e.selector) : null
      if (!b) continue
      kinds.forEach((t, i) => mark(`${t} ${e[t]}`, `badge ${t}`, b.left + b.width - 4 - i * 56, b.top - 10))
    }
    const total = p.placed + p.unplaced
    // Built from nodes and text only: nothing from the API is ever parsed as HTML.
    const para = (cls: string, ...parts: (string | [string])[]) => {
      const el = doc.createElement('p')
      if (cls) el.className = cls
      for (const part of parts) {
        if (typeof part === 'string') el.append(part)
        else {
          const b = doc.createElement('b')
          b.textContent = part[0]
          el.append(b)
        }
      }
      return el
    }
    stats.replaceChildren(para('', [String(total)], ' clicks · ', [String(data.views)], ' page views'))
    if (data.small) stats.append(para('warn', 'Small sample: under 30 page views, shares can swing widely.'))
    if (p.unplaced > 0) {
      const details = doc.createElement('details')
      const summary = doc.createElement('summary')
      const b = doc.createElement('b')
      b.textContent = `${Math.round((p.unplaced / total) * 100)}%`
      summary.append(b, ' of clicks are not on this page as it is now')
      const ul = doc.createElement('ul')
      for (const m of p.missing.slice(0, 12)) {
        const li = doc.createElement('li')
        const code = doc.createElement('code')
        code.textContent = m.selector
        li.append(code, ` ${m.count}`)
        ul.append(li)
      }
      details.append(summary, ul)
      stats.append(details)
    } else stats.append(total > 0 ? para('ok', 'Every click is placed on this page as it is now.') : para('', 'No clicks recorded yet for this screen size.'))
  }

  const mark = (text: string, cls: string, x: number, y: number) => {
    const m = doc.createElement('span')
    m.className = cls
    m.textContent = text
    m.style.cssText = `left:${Math.max(0, x)}px;top:${Math.max(0, y)}px`
    marks.appendChild(m)
  }

  const scrollBand = (W: number, H: number) => {
    data!.scroll_reach.forEach((share, i) => {
      if (i === 9) return
      mark(`${Math.round(share * 100)}% reach here`, 'reach', W - 128, ((i + 1) * H) / 10)
    })
  }

  const load = async () => {
    stats.textContent = 'Loading…'
    $<HTMLSpanElement>('.path').textContent = path
    try {
      const q = new URLSearchParams({ token, path, viewport: vp.value as Viewport })
      const res = await fetch(`${api}/v1/heatmaps/data?${q}`, { credentials: 'omit' })
      if (res.status === 401) throw new Error('This heatmap link has expired. Open it again from the dashboard.')
      if (!res.ok) throw new Error(res.status === 403 ? 'This page is not on one of the site\'s domains.' : 'The heatmap could not be loaded.')
      data = parseData(await res.json())
      draw()
    } catch (e) {
      data = null
      const warn = doc.createElement('p')
      warn.className = 'warn'
      warn.textContent = e instanceof TypeError ? 'The heatmap could not be loaded (network or the site\'s Content-Security-Policy).' : (e as Error).message
      const back = doc.createElement('a')
      back.href = api // the configured dashboard, checked by the tracker before loading this script
      back.target = '_blank'
      back.rel = 'noopener'
      back.textContent = 'Open the dashboard'
      stats.replaceChildren(warn, back)
    }
  }

  const redraw = () => {
    clearTimeout(timer)
    timer = window.setTimeout(draw, 250)
  }
  const observer = new MutationObserver((ms) => ms.some((m) => !host.contains(m.target)) && redraw())
  observer.observe(doc.body, { subtree: true, childList: true, attributes: true, characterData: true })
  addEventListener('resize', redraw)
  // An SPA route change shows another page: load its heatmap.
  const route = setInterval(() => {
    if (storedPath(location.pathname) !== path) {
      path = storedPath(location.pathname)
      void load()
    }
  }, 1_000)
  vp.addEventListener('change', () => void load())
  root.querySelectorAll<HTMLInputElement>('.layers input').forEach((i) =>
    i.addEventListener('change', () => {
      i.checked ? layers.add(i.value as Layer) : layers.delete(i.value as Layer)
      draw()
    }),
  )
  $<HTMLButtonElement>('.close').addEventListener('click', () => {
    observer.disconnect()
    clearInterval(route)
    removeEventListener('resize', redraw)
    host.remove()
  })
  void load()
}

/* Classic heatmap: points add up as alpha in grey, then the alpha is coloured through a palette. */
function heat(ctx: CanvasRenderingContext2D, points: { x: number; y: number; count: number }[], k: number) {
  if (points.length === 0) return
  const max = Math.max(...points.map((p) => p.count))
  const r = 28 * Math.max(0.5, k)
  for (const p of points) {
    const g = ctx.createRadialGradient(p.x * k, p.y * k, 0, p.x * k, p.y * k, r)
    g.addColorStop(0, `rgba(0,0,0,${0.25 + 0.75 * (p.count / max)})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(p.x * k - r, p.y * k - r, 2 * r, 2 * r)
  }
  const img = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height)
  const px = img.data
  const pal = palette()
  for (let i = 3; i < px.length; i += 4) {
    const a = px[i]!
    if (a === 0) continue
    px[i - 3] = pal[a * 4]!
    px[i - 2] = pal[a * 4 + 1]!
    px[i - 1] = pal[a * 4 + 2]!
    px[i] = Math.min(220, a + 60)
  }
  ctx.putImageData(img, 0, 0)
}

function palette(): Uint8ClampedArray {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 1
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 256, 0)
  g.addColorStop(0.2, '#3b82f6')
  g.addColorStop(0.45, '#22d3ee')
  g.addColorStop(0.65, '#a3e635')
  g.addColorStop(0.85, '#facc15')
  g.addColorStop(1, '#ef4444')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 1)
  return ctx.getImageData(0, 0, 256, 1).data
}

const CSS = `
:host{all:initial}
.marks{position:absolute;top:0;left:0}
.badge,.reach{position:absolute;font:600 11px/1 system-ui,sans-serif;padding:4px 6px;border-radius:6px;white-space:nowrap;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.25)}
.badge.rage{background:#dc2626}.badge.dead{background:#7c3aed}
.reach{background:rgba(15,23,42,.85);border-left:3px solid #22d3ee}
.panel{position:fixed;right:16px;bottom:16px;width:280px;pointer-events:auto;background:#0f1218;color:#e8ebf2;border:1px solid #262b36;border-radius:14px;padding:14px;font:13px/1.45 system-ui,sans-serif;box-shadow:0 18px 48px rgba(0,0,0,.4)}
header{display:flex;align-items:center;gap:8px;margin-bottom:10px}
header .path{flex:1;color:#8b93a7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,monospace;font-size:12px}
.close{all:unset;cursor:pointer;width:28px;height:28px;display:grid;place-items:center;border-radius:8px;color:#8b93a7;font-size:18px}
.close:hover,.close:focus-visible{background:#1c212b;color:#fff;outline:2px solid #6366f1}
.row{margin:8px 0}.layers{display:flex;flex-wrap:wrap;gap:10px}
select{background:#1c212b;color:#e8ebf2;border:1px solid #262b36;border-radius:8px;padding:4px 6px;margin-left:6px}
.stats p{margin:6px 0}.warn{color:#fbbf24}.ok{color:#4ade80}
details{margin-top:6px}summary{cursor:pointer}ul{margin:6px 0 0;padding-left:16px;max-height:140px;overflow:auto}
code{font:11px ui-monospace,monospace;color:#c4b5fd;word-break:break-all}
a{color:#a5b4fc}
`

// Last: everything above (the styles included) must exist before the overlay starts.
const link = (window as unknown as { __ptOverlay?: { token: string; api: string } }).__ptOverlay
if (link) start(link)
