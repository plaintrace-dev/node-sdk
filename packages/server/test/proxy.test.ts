import { expect, test, vi } from 'vitest'
import { createClient } from '../src/index.js'
import { signingSecret, sign } from '../src/sign.js'
import { CHROME, ENDPOINT, KEY, fakeFetch } from './helpers.js'

const events = (body = '{"site_id":"s","events":[]}') =>
  new Request('https://a.com/_i/v1/events', {
    method: 'POST',
    body,
    headers: { 'user-agent': CHROME, cookie: 'session=secret', origin: 'https://a.com', 'cf-connecting-ip': '203.0.113.7', 'content-type': 'text/plain' },
  })

test('forwards a tracker batch signed, with the visitor address and without cookies', async () => {
  const f = fakeFetch(() => new Response('{"accepted":0}', { status: 202, headers: { 'set-cookie': 'x=1', 'content-type': 'application/json', 'retry-after': '1' } }))
  const client = createClient({ key: KEY, endpoint: ENDPOINT, ipHeader: 'cf-connecting-ip', fetch: f.fn })
  const res = await client.proxy(events())
  expect(res?.status).toBe(202)
  expect(res?.headers.get('set-cookie')).toBeNull()
  expect(res?.headers.get('retry-after')).toBe('1')

  const sent = f.calls[0]!
  expect(sent.url).toBe(`${ENDPOINT}/v1/events`)
  expect(sent.headers.get('authorization')).toBe(`Bearer ${KEY}`)
  expect(sent.headers.get('x-client-ip')).toBe('203.0.113.7')
  expect(sent.headers.get('cookie')).toBeNull()
  expect(sent.headers.get('origin')).toBe('https://a.com')
  const t = Number(/t=(\d+)/.exec(sent.headers.get('x-signature')!)![1])
  expect(sent.headers.get('x-signature')).toBe(await sign(await signingSecret(KEY), t, 'POST', '/v1/events', new TextEncoder().encode(sent.body)))
})

test('passes non-tracker paths and refuses odd methods', async () => {
  const f = fakeFetch()
  const client = createClient({ key: KEY, endpoint: ENDPOINT, ipHeader: 'cf-connecting-ip', fetch: f.fn })
  expect(await client.proxy(new Request('https://a.com/about'))).toBeNull()
  expect(await client.proxy(new Request('https://a.com/_i/other'))).toBeNull()
  expect((await client.proxy(new Request('https://a.com/_i/v1/events', { method: 'PUT', body: 'x' })))?.status).toBe(405)
  expect(f.calls).toHaveLength(0)
})

test('custom prefix', async () => {
  const f = fakeFetch(() => new Response('{}', { status: 200 }))
  const client = createClient({ key: KEY, endpoint: ENDPOINT, ipHeader: 'cf-connecting-ip', fetch: f.fn })
  expect((await client.proxy(new Request('https://a.com/stats/v1/config?site=s'), { prefix: '/stats' }))?.status).toBe(200)
  expect(f.calls[0]!.url).toBe(`${ENDPOINT}/v1/config?site=s`)
})

test('an unreachable collector is a 502, never a throw', async () => {
  const onError = vi.fn()
  const client = createClient({ key: KEY, endpoint: ENDPOINT, ipHeader: 'cf-connecting-ip', onError, fetch: (async () => { throw new Error('down') }) as typeof fetch })
  expect((await client.proxy(events()))?.status).toBe(502)
  expect(onError).toHaveBeenCalled()
})

test('a body over 1 MiB is refused before it is read', async () => {
  const f = fakeFetch()
  const client = createClient({ key: KEY, endpoint: ENDPOINT, ipHeader: 'cf-connecting-ip', fetch: f.fn })
  const big = new Request('https://a.com/_i/v1/events', { method: 'POST', body: 'x', headers: { 'content-length': String(2 * 1024 * 1024) } })
  expect((await client.proxy(big))?.status).toBe(413)
})

test('a missing visitor address is reported once', async () => {
  const onError = vi.fn()
  const f = fakeFetch(() => new Response('{"error":{"code":"client_ip_unresolved"}}', { status: 400 }))
  const client = createClient({ key: KEY, endpoint: ENDPOINT, ipHeader: 'cf-connecting-ip', fetch: f.fn, onError })
  const noIp = () => new Request('https://a.com/_i/v1/events', { method: 'POST', body: '{}' })
  await client.proxy(noIp())
  await client.proxy(noIp())
  expect(onError).toHaveBeenCalledTimes(1)
  expect(onError.mock.calls[0]![0].code).toBe('CLIENT_IP_UNRESOLVED')
  expect(f.calls[0]!.headers.get('x-client-ip')).toBeNull()
})

test('the versioned script path is proxied', async () => {
  const f = fakeFetch(() => new Response('/*js*/', { status: 200, headers: { 'content-type': 'text/javascript' } }))
  const client = createClient({ key: KEY, endpoint: ENDPOINT, fetch: f.fn })
  expect((await client.proxy(new Request('https://a.com/_i/v/0.1.0/t.js')))?.status).toBe(200)
  expect(f.calls[0]!.url).toBe(`${ENDPOINT}/v/0.1.0/t.js`)
  expect(await client.proxy(new Request('https://a.com/_i/v/latest/t.js'))).toBeNull()
})
