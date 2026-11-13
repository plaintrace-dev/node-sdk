/* The client half of the collector's redaction (internal/sanitize): data is cleaned before it
   leaves the browser, and the collector applies the same rules again for any other sender. */

export const REDACTED = '[redacted]'
const URL_MAX = 1024
const TITLE_MAX = 256
const VALUE_MAX = 256
const KEY_MAX = 40
const MAX_PROPS = 32
const RESERVED = 'px_'

const DEFAULT_KEYS = new Set([
  'access_token', 'api_key', 'apikey', 'auth', 'code', 'email', 'id_token', 'invite', 'jwt', 'key', 'otp',
  'password', 'phone', 'pwd', 'reset', 'secret', 'session', 'sid', 'signature', 'state', 'token',
])
const SENSITIVE = /(pass(word|wd)?|secret|token|auth|session|email|phone|credential)/i
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/g
const DIGIT_RUN = /\+?\d[\d\s().-]{6,}\d/g
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN = /^[A-Za-z0-9_-]{24,}$/
const EMAIL_SEGMENT = /^[^@/]+@[^@/]+\.[^@/]{2,}$/
const PROP_KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/

const truncate = (s: string, max: number): string => (s.length <= max ? s : Array.from(s).slice(0, max).join(''))

const digits = (s: string): number => s.replace(/\D/g, '').length

/** Redacts emails and runs of nine or more digits (phone, card and id numbers). */
export function redactText(s: string): string {
  return s.replace(EMAIL, REDACTED).replace(DIGIT_RUN, (m) => (digits(m) >= 9 ? REDACTED : m))
}

function isRedactedKey(key: string, extra: readonly string[]): boolean {
  const k = key.toLowerCase()
  return DEFAULT_KEYS.has(k) || SENSITIVE.test(k) || extra.some((e) => e.toLowerCase() === k)
}

const SLUG = /^[a-z0-9]+([-_][a-z0-9]+)+$/
const CONSONANTS = /[b-df-hj-np-tv-xz]{5,}/

/* A long readable page name ("resize-for-instagram-post") is not a token: lowercase words joined by - or _,
   each at most 16 characters, without the letter-digit back-and-forth of random strings ("base64" and
   "1920x1080" pass, "k3j4h5g6" does not) and without five consonants in a row; and not a chunked code
   (three or more words of the same length, "ab3k-9xqz-mm2p"). Same rule as the collector's isSlug. */
function isSlug(s: string): boolean {
  if (!SLUG.test(s)) return false
  const words = s.split(/[-_]/)
  if (words.length >= 3 && words.every((w) => w.length === words[0]!.length)) return false
  return words.every((w) => {
    if (w.length > 16 || CONSONANTS.test(w)) return false
    let flips = 0
    for (let i = 1; i < w.length; i++) if (/\d/.test(w[i]!) !== /\d/.test(w[i - 1]!)) flips++
    return flips <= 2
  })
}

const isId = (s: string): boolean => digits(s) >= 9 || UUID.test(s) || (TOKEN.test(s) && !isSlug(s)) || EMAIL_SEGMENT.test(s)

function segment(raw: string): string {
  if (raw === '') return raw
  let s = raw
  try {
    s = decodeURIComponent(raw)
  } catch {}
  return isId(s) ? ':id' : raw
}

/* A cut can end inside a multi-byte character (%E2%82 of %E2%82%AC): valid escapes that do not
   decode. Only the trailing escapes are looked at; anything earlier is left as it was. */
function dropPartialUtf8(s: string): string {
  const tail = s.match(/(?:%[0-9A-Fa-f]{2}){1,3}$/)?.[0]
  if (!tail) return s
  const bytes = tail.slice(1).split('%').map((h) => parseInt(h, 16))
  for (let i = bytes.length - 1; i >= 0; i--) {
    const b = bytes[i]!
    if (b < 0x80) return s // plain ASCII: nothing open
    if (b >= 0xc0) {
      const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : 2
      const have = bytes.length - i
      return have < need ? s.slice(0, s.length - 3 * have) : s
    }
  }
  return s
}

/** A page URL without fragment, credentials, sensitive parameters or ids in its path; '' when not http(s). */
export function cleanUrl(href: string, extraKeys: readonly string[]): string {
  let u: URL
  try {
    u = new URL(href)
  } catch {
    return ''
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
  u.hash = ''
  u.username = ''
  u.password = ''
  u.pathname = u.pathname.split('/').map(segment).join('/')
  const kept = new URLSearchParams()
  u.searchParams.forEach((value, key) => {
    if (!isRedactedKey(key, extraKeys)) kept.append(key, truncate(redactText(value), VALUE_MAX))
  })
  const query = kept.toString()
  u.search = query
  // A cut can land inside a %-escape: drop the broken tail.
  const full = u.toString()
  // Only a cut can leave a broken escape; an address that fits is kept exactly as it is.
  return full.length <= URL_MAX ? full : dropPartialUtf8(truncate(full, URL_MAX).replace(/%[0-9A-Fa-f]?$/, ''))
}

/** The path as the collector stores it (Go sanitize.URL): each segment decoded, ids as ":id".
    The heatmap overlay asks for this, so its data matches what was recorded. */
export function storedPath(pathname: string): string {
  const path = pathname
    .split('/')
    .map((raw) => {
      if (raw === '') return raw
      let s = raw
      try {
        s = decodeURIComponent(raw)
      } catch {}
      return isId(s) ? ':id' : s
    })
    .join('/')
  return truncate(path, URL_MAX) || '/'
}

export function cleanTitle(s: string): string {
  return truncate(redactText(s), TITLE_MAX)
}

export type PropertyValue = string | number | boolean | null

/** At most 32 valid, non-sensitive properties (nulls are dropped, as the collector does); undefined when none remain. */
export function cleanProps(p: Record<string, unknown> | undefined, extraKeys: readonly string[] = []): Record<string, PropertyValue> | undefined {
  if (!p) return undefined
  const out: Record<string, PropertyValue> = {}
  let n = 0
  for (const key of Object.keys(p).sort()) {
    if (n >= MAX_PROPS) break
    if (key.length > KEY_MAX || !PROP_KEY.test(key) || key.toLowerCase().startsWith(RESERVED) || isRedactedKey(key, extraKeys)) continue
    const v = p[key]
    if (typeof v === 'string') out[key] = truncate(redactText(v), VALUE_MAX)
    else if (typeof v === 'boolean') out[key] = v
    else if (typeof v === 'number' && Number.isFinite(v)) out[key] = v
    else continue
    n++
  }
  return n === 0 ? undefined : out
}

export function isValidName(n: unknown): n is string {
  return typeof n === 'string' && NAME.test(n)
}
