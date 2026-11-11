import { authHeaders, report, type Context } from './context.js'
import { ClientError } from './errors.js'

export const DEFAULT_PREFIX = '/_i'
const PATHS = [/^\/t\.js$/, /^\/t-[a-z\d-]+\.js$/, /^\/v\/\d+\.\d+\.\d+\/t\.js$/, /^\/overlay\.js$/, /^\/v\/\d+\.\d+\.\d+\/overlay\.js$/, /^\/v1\/events$/, /^\/v1\/config$/, /^\/v1\/sdk$/]
const METHODS = new Set(['GET', 'HEAD', 'POST'])
const MAX_BODY = 1024 * 1024
const NULL_BODY = new Set([204, 205, 304])
/* Only what the collector needs; cookies, the site's own Authorization and Host stay here. */
const FORWARD = ['user-agent', 'accept', 'accept-language', 'content-type', 'origin', 'referer', 'if-none-match', 'sec-gpc']
const FORWARD_PREFIXES = ['sec-fetch-', 'sec-ch-ua']
const BACK = ['content-type', 'cache-control', 'etag', 'vary', 'retry-after']

export interface ProxyOptions {
  /** The path the tracker is served under on your site. Default "/_i". */
  readonly prefix?: string
  /** The visitor's address when no edge header carries it (bare Node, Bun, Deno). */
  readonly ip?: string | null
}

export function trackerPath(pathname: string, prefix = DEFAULT_PREFIX): string | null {
  const base = prefix.replace(/\/+$/, '')
  if (!pathname.startsWith(`${base}/`)) return null
  const path = pathname.slice(base.length)
  return PATHS.some((p) => p.test(path)) ? path : null
}

const json = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } })

export async function proxyRequest(ctx: Context, warnIp: () => void, req: Request, o: ProxyOptions = {}): Promise<Response | null> {
  const url = new URL(req.url)
  const path = trackerPath(url.pathname, o.prefix)
  if (path === null) return null
  if (!METHODS.has(req.method)) return new Response(null, { status: 405, headers: { allow: 'GET, HEAD, POST' } })
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return json(413)
  try {
    const body = req.method === 'POST' ? new Uint8Array(await req.arrayBuffer()) : new Uint8Array()
    if (body.byteLength > MAX_BODY) return json(413)
    const headers = new Headers()
    for (const [name, value] of req.headers) {
      if (FORWARD.includes(name) || FORWARD_PREFIXES.some((p) => name.startsWith(p))) headers.set(name, value)
    }
    headers.set('accept-encoding', 'identity')
    const ip = o.ip ?? ctx.clientIp(req)
    if (ip) headers.set('x-client-ip', ip)
    else warnIp()
    if (req.method === 'POST') for (const [k, v] of Object.entries(await authHeaders(ctx, 'POST', path, body))) headers.set(k, v)

    const upstream = await ctx.fetch(`${ctx.endpoint}${path}${url.search}`, {
      method: req.method,
      headers,
      body: req.method === 'POST' ? body : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(ctx.timeoutMs),
    })
    const back = new Headers()
    for (const [name, value] of upstream.headers) {
      if (BACK.includes(name) || name.startsWith('access-control-')) back.set(name, value)
    }
    const bodyless = req.method === 'HEAD' || NULL_BODY.has(upstream.status)
    return new Response(bodyless ? null : upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: back })
  } catch (error) {
    report(ctx, error)
    return json(502)
  }
}

export function ipWarner(ctx: Context): () => void {
  let warned = false
  return () => {
    if (warned) return
    warned = true
    report(ctx, new ClientError('CLIENT_IP_UNRESOLVED', 'A proxied visitor came without an address: pass `ip`, or clientIp to createClient.'))
  }
}
