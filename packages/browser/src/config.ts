export interface SiteConfig {
  readonly allowedDomains: string[]
  readonly redactQueryKeys: string[]
}

/** The site's collection settings; 'unknown_site' when the collector does not know it, null
    when it cannot be reached (the tracker then runs on defaults). */
export async function loadConfig(endpoint: string, site: string, fetchImpl: typeof fetch): Promise<SiteConfig | 'unknown_site' | null> {
  try {
    const res = await fetchImpl(`${endpoint}/v1/config?site=${encodeURIComponent(site)}`, { credentials: 'omit', mode: 'cors' })
    if (res.status === 404) return 'unknown_site'
    if (!res.ok) return null
    const body = (await res.json()) as { allowed_domains?: unknown; redact_query_keys?: unknown }
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    return { allowedDomains: strings(body.allowed_domains), redactQueryKeys: strings(body.redact_query_keys) }
  } catch {
    return null
  }
}

/** The collector's rule: an empty list allows every host; otherwise the host or a subdomain of an entry. */
export function hostAllowed(host: string, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return true
  const h = host.trim().toLowerCase()
  if (h === '') return false
  return allowed.some((a) => {
    const d = a.trim().toLowerCase().replace(/^\*\./, '')
    return d !== '' && (h === d || h.endsWith(`.${d}`))
  })
}
