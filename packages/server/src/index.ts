import { makeContext, report } from './context.js'
import { clientIp, headerClientIp } from './ip.js'
import { ipWarner, proxyRequest, type ProxyOptions } from './proxy.js'
import { sendCrawl, sendHit } from './signals.js'
import { trackEvent, type TrackOptions, type TrackResult } from './track.js'

export { ClientError } from './errors.js'
export { clientIp, headerClientIp } from './ip.js'
export { isCrawlerRead, isHumanDocument } from './signals.js'
export { sign, signingSecret } from './sign.js'
export type { ProxyOptions } from './proxy.js'
export type { PropertyValue, TrackOptions, TrackResult } from './track.js'

const KEY_PREFIX = 'sk_live_'

export interface ClientOptions {
  /** An API key with the ingest scope (sk_live_…). It is secret: never send it to a browser. */
  readonly key: string
  /** The collector's address. */
  readonly endpoint: string
  readonly fetch?: typeof fetch
  /** The one header your edge sets to the visitor's address (see headerClientIp). Without it
      (and without clientIp) only Cloudflare Workers' CF-Connecting-IP is trusted. */
  readonly ipHeader?: string
  /** Reads the visitor's address from a request; replaces ipHeader and the default. */
  readonly clientIp?: (req: Request) => string | null
  /** Told about failures that are not thrown. Default console.error. */
  readonly onError?: (error: unknown) => void
  /** Per call to the collector. Default 10 000 ms. */
  readonly timeoutMs?: number
  /** Count human page requests so reports can show measured loss. Default true. */
  readonly measureLoss?: boolean
}

export interface HandleOptions extends ProxyOptions {
  /** Keeps background recording alive after the response (event.waitUntil, ctx.waitUntil). */
  readonly waitUntil?: (promise: Promise<unknown>) => void
}

export interface Client {
  /** Proxies tracker requests; for any other request records crawler reads and human page
      loads in the background and resolves to null, so your app answers it. */
  handle(req: Request, o?: HandleOptions): Promise<Response | null>
  /** Forwards a tracker request under the prefix to the collector; null for any other path. Never rejects. */
  proxy(req: Request, o?: ProxyOptions): Promise<Response | null>
  /** Records the request when a crawler made it. Never rejects. */
  crawlers(req: Request, o?: { status?: number }): Promise<void>
  /** Counts the request when a person loaded a page. Pass the response status to count only
      successful loads (redirects and errors are no page view). Never rejects. */
  hits(req: Request, o?: { status?: number }): Promise<void>
  /** Sends a custom event for a visitor. Rejects with ClientError. */
  track(name: string, o: TrackOptions): Promise<TrackResult>
}

export function createClient(o: ClientOptions): Client {
  if (typeof o.key !== 'string' || !o.key.startsWith(KEY_PREFIX) || o.key.length <= KEY_PREFIX.length) {
    throw new TypeError(`createClient: key must be an API key with the ingest scope (${KEY_PREFIX}…).`)
  }
  if (typeof o.endpoint !== 'string' || o.endpoint === '') throw new TypeError('createClient: endpoint is required.')
  const ctx = makeContext({
    key: o.key,
    endpoint: o.endpoint,
    // Looked up per call: a fetch replaced after startup (instrumentation, tests) is still used.
    fetch: o.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    clientIp: o.clientIp ?? (o.ipHeader ? headerClientIp(o.ipHeader) : clientIp),
    onError: o.onError ?? ((e) => console.error('[analytics]', e)),
    timeoutMs: o.timeoutMs ?? 10_000,
    measureLoss: o.measureLoss !== false,
  })
  const warnIp = ipWarner(ctx)
  const crawlers = (req: Request, opts?: { status?: number }) => sendCrawl(ctx, req, opts?.status)
  const hits = (req: Request, opts?: { status?: number }) => (ctx.measureLoss ? sendHit(ctx, req, opts?.status) : Promise.resolve())

  return {
    proxy: (req, opts) => proxyRequest(ctx, warnIp, req, opts),
    crawlers,
    hits,
    track: (name, opts) => trackEvent(ctx, name, opts),
    async handle(req, opts) {
      const proxied = await proxyRequest(ctx, warnIp, req, opts)
      if (proxied) return proxied
      const background = Promise.all([crawlers(req), hits(req)]).catch((e) => report(ctx, e))
      opts?.waitUntil?.(background)
      return null
    },
  }
}
