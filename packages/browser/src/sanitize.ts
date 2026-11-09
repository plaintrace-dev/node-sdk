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

function segment(raw: string): string {
  if (raw === '') return raw
  let s = raw
  try {
    s = decodeURIComponent(raw)
  } catch {}
  return digits(s) >= 9 || UUID.test(s) || TOKEN.test(s) || EMAIL_SEGMENT.test(s) ? ':id' : raw
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
  return truncate(u.toString(), URL_MAX)
}

export function cleanTitle(s: string): string {
  return truncate(redactText(s), TITLE_MAX)
}

export type PropertyValue = string | number | boolean | null

/** At most 32 valid, non-sensitive properties; undefined when none remain. */
export function cleanProps(p: Record<string, unknown> | undefined, extraKeys: readonly string[] = []): Record<string, PropertyValue> | undefined {
  if (!p) return undefined
  const out: Record<string, PropertyValue> = {}
  let n = 0
  for (const key of Object.keys(p).sort()) {
    if (n >= MAX_PROPS) break
    if (key.length > KEY_MAX || !PROP_KEY.test(key) || key.toLowerCase().startsWith(RESERVED) || isRedactedKey(key, extraKeys)) continue
    const v = p[key]
    if (typeof v === 'string') out[key] = truncate(redactText(v), VALUE_MAX)
    else if (typeof v === 'boolean' || v === null) out[key] = v
    else if (typeof v === 'number' && Number.isFinite(v)) out[key] = v
    else continue
    n++
  }
  return n === 0 ? undefined : out
}

export function isValidName(n: unknown): n is string {
  return typeof n === 'string' && NAME.test(n)
}
