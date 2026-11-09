const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/

function isIpv6(v: string): boolean {
  if (!v.includes(':') || !/^[\da-f:.]+$/i.test(v)) return false
  try {
    new URL(`http://[${v}]/`)
    return true
  } catch {
    return false
  }
}

/** One address in canonical form, or null: brackets, ports and the IPv4-mapped prefix are removed. */
export function bareAddress(value: string): string | null {
  let a = value.trim()
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(a)
  if (bracketed) a = bracketed[1] ?? ''
  else {
    const withPort = /^([\d.]+):\d{1,5}$/.exec(a)
    if (withPort) a = withPort[1] ?? ''
  }
  // A dual-stack socket reports IPv4 peers as ::ffff:a.b.c.d; the same visitor must hash the same.
  a = a.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '')
  if (IPV4.test(a)) return a
  return isIpv6(a) ? a.toLowerCase() : null
}

/**
 * Reads the visitor's address from one header your own edge sets (and overwrites):
 * "cf-connecting-ip" behind Cloudflare, "x-vercel-forwarded-for" on Vercel, "fly-client-ip"
 * on Fly, "x-real-ip" behind an nginx that sets it. For "x-forwarded-for" the right-most
 * entry is used: the one your nearest proxy appended, not one the visitor wrote.
 */
export function headerClientIp(name: string): (req: Request) => string | null {
  const header = name.toLowerCase()
  return (req) => {
    const value = req.headers.get(header)
    if (value === null) return null
    const parts = value.split(',')
    return bareAddress((header === 'x-forwarded-for' ? parts[parts.length - 1] : parts[0]) ?? '')
  }
}

const cloudflare = headerClientIp('cf-connecting-ip')

/**
 * The default: only an address the platform itself guarantees. On Cloudflare Workers
 * (the request carries `cf`) that is CF-Connecting-IP; anywhere else a visitor can send any
 * header themselves, so the default reads none — set `ipHeader`, or pass `ip`.
 */
export function clientIp(req: Request): string | null {
  return 'cf' in req ? cloudflare(req) : null
}
