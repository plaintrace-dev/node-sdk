import { isbot } from 'isbot'
import { postSigned, report, type Context } from './context.js'

const STATIC = /\.(?:css|m?js|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf)$/i
const NOT_A_PAGE = /\.(?:txt|xml|json)$/i

function framework(req: Request): boolean {
  const purpose = `${req.headers.get('sec-purpose') ?? ''} ${req.headers.get('purpose') ?? ''}`
  return /prefetch/i.test(purpose) || req.headers.has('rsc') || req.headers.has('next-router-prefetch')
}

function documentDest(req: Request): boolean {
  const dest = req.headers.get('sec-fetch-dest')
  return dest === null || dest === 'document'
}

/** A page a person loaded: what the tracker should also report as a page view. */
export function isHumanDocument(req: Request): boolean {
  const path = new URL(req.url).pathname
  return (
    req.method === 'GET' &&
    documentDest(req) &&
    !framework(req) &&
    !STATIC.test(path) &&
    !NOT_A_PAGE.test(path) &&
    !isbot(req.headers.get('user-agent') ?? '')
  )
}

/** A crawler reading a page, robots.txt or a sitemap (the collector names the crawler). */
export function isCrawlerRead(req: Request): boolean {
  const ua = req.headers.get('user-agent') ?? ''
  return (
    isbot(ua) &&
    (req.method === 'GET' || req.method === 'HEAD') &&
    documentDest(req) &&
    !req.headers.has('rsc') &&
    !STATIC.test(new URL(req.url).pathname)
  )
}

export async function sendCrawl(ctx: Context, req: Request, status = 200): Promise<void> {
  if (!isCrawlerRead(req)) return
  const url = new URL(req.url)
  try {
    await postSigned(ctx, '/v1/crawls', {
      hits: [{ timestamp: new Date().toISOString(), method: req.method, hostname: url.hostname, path: url.pathname, status, user_agent: (req.headers.get('user-agent') ?? '').slice(0, 512) }],
    })
  } catch (error) {
    report(ctx, error)
  }
}

export async function sendHit(ctx: Context, req: Request, status?: number): Promise<void> {
  if (!isHumanDocument(req)) return
  if (status !== undefined && (status < 200 || status > 299)) return
  try {
    await postSigned(ctx, '/v1/server/hits', { hits: [{ path: new URL(req.url).pathname, count: 1 }] })
  } catch (error) {
    report(ctx, error)
  }
}
