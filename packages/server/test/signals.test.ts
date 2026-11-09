import { expect, test, vi } from 'vitest'
import { createClient } from '../src/index.js'
import { isCrawlerRead, isHumanDocument } from '../src/signals.js'
import { CHROME, ENDPOINT, GPTBOT, KEY, fakeFetch } from './helpers.js'

const get = (path: string, headers: Record<string, string>) => new Request(`https://a.com${path}`, { headers })

test('isHumanDocument counts only real page loads by people', () => {
  expect(isHumanDocument(get('/pricing', { 'user-agent': CHROME, 'sec-fetch-dest': 'document' }))).toBe(true)
  expect(isHumanDocument(get('/pricing', { 'user-agent': CHROME }))).toBe(true)
  expect(isHumanDocument(get('/pricing', { 'user-agent': CHROME, 'sec-fetch-dest': 'empty' }))).toBe(false)
  expect(isHumanDocument(get('/pricing', { 'user-agent': CHROME, 'sec-purpose': 'prefetch;prerender' }))).toBe(false)
  expect(isHumanDocument(get('/pricing', { 'user-agent': CHROME, purpose: 'prefetch' }))).toBe(false)
  expect(isHumanDocument(get('/pricing', { 'user-agent': CHROME, rsc: '1' }))).toBe(false)
  expect(isHumanDocument(get('/pricing', { 'user-agent': CHROME, 'next-router-prefetch': '1' }))).toBe(false)
  expect(isHumanDocument(get('/a.css', { 'user-agent': CHROME }))).toBe(false)
  expect(isHumanDocument(get('/sitemap.xml', { 'user-agent': CHROME }))).toBe(false)
  expect(isHumanDocument(get('/', { 'user-agent': GPTBOT }))).toBe(false)
  expect(isHumanDocument(new Request('https://a.com/', { method: 'POST', body: 'x', headers: { 'user-agent': CHROME } }))).toBe(false)
})

test('isCrawlerRead sees bots reading pages, robots.txt and sitemaps', () => {
  expect(isCrawlerRead(get('/', { 'user-agent': GPTBOT }))).toBe(true)
  expect(isCrawlerRead(get('/robots.txt', { 'user-agent': GPTBOT }))).toBe(true)
  expect(isCrawlerRead(get('/sitemap.xml', { 'user-agent': GPTBOT }))).toBe(true)
  expect(isCrawlerRead(get('/app.js', { 'user-agent': GPTBOT }))).toBe(false)
  expect(isCrawlerRead(get('/', { 'user-agent': GPTBOT, 'sec-fetch-dest': 'script' }))).toBe(false)
  expect(isCrawlerRead(get('/', { 'user-agent': CHROME }))).toBe(false)
})

test('crawlers() and hits() send signed records and never reject', async () => {
  const f = fakeFetch()
  const client = createClient({ key: KEY, endpoint: ENDPOINT, fetch: f.fn })
  await client.crawlers(get('/docs', { 'user-agent': GPTBOT }), { status: 404 })
  await client.hits(get('/u/1?x=1', { 'user-agent': CHROME }))
  expect(f.calls.map((c) => c.url)).toEqual([`${ENDPOINT}/v1/crawls`, `${ENDPOINT}/v1/server/hits`])
  const crawl = JSON.parse(f.calls[0]!.body).hits[0]
  expect(crawl).toMatchObject({ method: 'GET', hostname: 'a.com', path: '/docs', status: 404, user_agent: GPTBOT })
  expect(JSON.parse(f.calls[1]!.body)).toEqual({ hits: [{ path: '/u/1', count: 1 }] })
  expect(f.calls[0]!.headers.get('x-signature')).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/)

  const onError = vi.fn()
  const down = createClient({ key: KEY, endpoint: ENDPOINT, onError, fetch: (async () => { throw new Error('down') }) as typeof fetch })
  await expect(down.crawlers(get('/', { 'user-agent': GPTBOT }))).resolves.toBeUndefined()
  await expect(down.hits(get('/', { 'user-agent': CHROME }))).resolves.toBeUndefined()
  expect(onError).toHaveBeenCalledTimes(2)
})

test('handle() proxies, or records in the background and returns null', async () => {
  const f = fakeFetch()
  const pending: Promise<unknown>[] = []
  const client = createClient({ key: KEY, endpoint: ENDPOINT, fetch: f.fn })
  expect(await client.handle(get('/', { 'user-agent': CHROME, 'sec-fetch-dest': 'document' }), { waitUntil: (p) => pending.push(p) })).toBeNull()
  expect(await client.handle(get('/', { 'user-agent': GPTBOT }), { waitUntil: (p) => pending.push(p) })).toBeNull()
  expect(await client.handle(get('/a.png', { 'user-agent': CHROME }), { waitUntil: (p) => pending.push(p) })).toBeNull()
  await Promise.all(pending)
  // The two background sends run concurrently: their order is not defined.
  expect(f.calls.map((c) => new URL(c.url).pathname).sort()).toEqual(['/v1/crawls', '/v1/server/hits'])

  const quiet = fakeFetch()
  const noLoss = createClient({ key: KEY, endpoint: ENDPOINT, fetch: quiet.fn, measureLoss: false })
  await noLoss.handle(get('/', { 'user-agent': CHROME }))
  expect(quiet.calls).toHaveLength(0)
})

test('hits() counts only successful page loads when told the status', async () => {
  const f = fakeFetch()
  const client = createClient({ key: KEY, endpoint: ENDPOINT, fetch: f.fn })
  await client.hits(get('/old', { 'user-agent': CHROME }), { status: 301 })
  await client.hits(get('/missing', { 'user-agent': CHROME }), { status: 404 })
  await client.hits(get('/ok', { 'user-agent': CHROME }), { status: 200 })
  expect(f.calls.map((c) => JSON.parse(c.body).hits[0].path)).toEqual(['/ok'])
})
