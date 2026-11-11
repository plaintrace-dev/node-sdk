/* Element selectors for heatmaps, stable across deploys where possible. A selector is a chain of
   segments joined by " > " (the first matches anywhere, each next one a direct child). A segment
   is a CSS compound, optionally followed by ":t(xxxxxx)", a hash of the element's text: buttons
   and links are told apart by what they say without the text ever leaving the browser. */

const MAX_LENGTH = 256
const MAX_DEPTH = 5
const STABLE_ATTRIBUTES = ['data-testid', 'data-test', 'data-cy', 'data-track']
const TEXT_MAX = 80

// Ids and classes a framework or bundler made up change on every build: never use them.
const generated = (s: string) => s.length > 40 || /^(css|sc|jsx|emotion|chakra|svelte|mui|makeStyles|tw)-|^_|^:|[0-9a-f]{6,}|\d{4,}/i.test(s)
// Only values that read as code, not data: no runs of digits (order or user ids), no '@', short.
const codeLike = (v: string) => v.length <= 40 && /^[A-Za-z][\w-]*$/.test(v) && !/\d{3,}/.test(v) && !generated(v)
const escape = (s: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, '\\$&'))
const normal = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** Six hex characters of an FNV-1a hash of the normalised text. */
export function textHash(text: string): string {
  let h = 0x811c9dc5
  for (const ch of normal(text)) {
    h ^= ch.codePointAt(0)!
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6)
}

function segment(el: Element): string {
  const tag = el.tagName.toLowerCase()
  if (el.id && codeLike(el.id)) return `#${escape(el.id)}`
  for (const a of STABLE_ATTRIBUTES) {
    const v = el.getAttribute(a)
    if (v && codeLike(v)) return `${tag}[${a}="${v}"]`
  }
  const css = tag + [...el.classList].filter(codeLike).slice(0, 2).map((c) => `.${escape(c)}`).join('')
  const clickable = tag === 'button' || tag === 'a' || el.getAttribute('role') === 'button'
  const text = clickable && !(el as HTMLElement).isContentEditable ? normal(el.textContent ?? '') : ''
  return text && text.length <= TEXT_MAX ? `${css}:t(${textHash(text)})` : css
}

const nth = (el: Element) => {
  let i = 1
  for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === el.tagName) i++
  return i
}

/** Every element the selector matches under root. */
export function resolveAll(selector: string, root: ParentNode): Element[] {
  let found: Element[] | null = null
  for (const part of selector.split(' > ')) {
    const m = part.match(/^(.*?)(?::t\(([0-9a-f]{6})\))?$/)
    const css = m?.[1] ?? ''
    const hash = m?.[2]
    let next: Element[]
    try {
      next = found === null ? [...root.querySelectorAll(css)] : found.flatMap((p) => [...p.children].filter((c) => c.matches(css)))
    } catch {
      return [] // a selector the browser cannot parse matches nothing
    }
    found = hash ? next.filter((e) => textHash(e.textContent ?? '') === hash) : next
    if (found.length === 0) return []
  }
  return found ?? []
}

/** The element the selector points at on this page, or null when the page no longer has it. */
export function resolve(selector: string, root: ParentNode): Element | null {
  return resolveAll(selector, root)[0] ?? null
}

const fit = (parts: string[]) => {
  while (parts.length > 1 && parts.join(' > ').length > MAX_LENGTH) parts.shift()
  return parts.join(' > ').slice(0, MAX_LENGTH)
}

/** A selector for el: as short as it can be while matching only el; nth-of-type as a last resort. */
export function selectorFor(el: Element): string {
  const doc = el.ownerDocument
  const chain: Element[] = []
  for (let cur: Element | null = el; cur && cur !== doc.documentElement && chain.length < MAX_DEPTH; cur = cur.parentElement) {
    chain.unshift(cur)
    const s = chain.map(segment).join(' > ')
    if (resolveAll(s, doc).length === 1) return fit(chain.map(segment))
  }
  return fit(chain.map((e) => `${segment(e).replace(/:t\([0-9a-f]{6}\)$/, '')}:nth-of-type(${nth(e)})`))
}
