import { expect, test } from 'vitest'
import { ClientError, createClient } from '../src/index.js'
import { CHROME, ENDPOINT, KEY, fakeFetch } from './helpers.js'

const visitorRequest = () => new Request('https://a.com/checkout', { headers: { 'user-agent': CHROME, 'cf-connecting-ip': '203.0.113.7', 'accept-language': 'tr-TR,tr;q=0.9' } })

test('track() describes the visitor from their request', async () => {
  const f = fakeFetch(() => new Response('{"accepted":1,"duplicate":0,"rejected":[]}', { status: 202 }))
  const client = createClient({ key: KEY, endpoint: ENDPOINT, ipHeader: 'cf-connecting-ip', fetch: f.fn })
  expect(await client.track('purchase', { request: visitorRequest(), properties: { plan: 'pro' }, userId: 'u-42' })).toEqual({ accepted: 1, duplicate: 0 })
  const sent = JSON.parse(f.calls[0]!.body)
  expect(f.calls[0]!.url).toBe(`${ENDPOINT}/v1/server/events`)
  expect(sent.visitor).toEqual({ ip: '203.0.113.7', user_agent: CHROME, language: 'tr-TR,tr;q=0.9' })
  expect(sent.events[0]).toMatchObject({ name: 'purchase', url: 'https://a.com/checkout', properties: { plan: 'pro' }, external_user_id: 'u-42' })
  expect(sent.events[0].event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('track() with an explicit visitor and event id', async () => {
  const f = fakeFetch(() => new Response('{"accepted":0,"duplicate":1}', { status: 202 }))
  const client = createClient({ key: KEY, endpoint: ENDPOINT, ipHeader: 'cf-connecting-ip', fetch: f.fn })
  const id = '019a5b2c-8f3e-7a1b-9c2d-3e4f5a6b7c8d'
  expect(await client.track('a', { visitor: { ip: '1.2.3.4', userAgent: CHROME }, eventId: id })).toEqual({ accepted: 0, duplicate: 1 })
  expect(JSON.parse(f.calls[0]!.body).events[0].event_id).toBe(id)
})

test('track() rejects with the collector error code', async () => {
  const f = fakeFetch(() => new Response('{"error":{"code":"user_agent_missing"}}', { status: 400 }))
  const client = createClient({ key: KEY, endpoint: ENDPOINT, ipHeader: 'cf-connecting-ip', fetch: f.fn })
  const err = await client.track('a', { visitor: { ip: '1.2.3.4', userAgent: 'x' } }).catch((e) => e)
  expect(err).toBeInstanceOf(ClientError)
  expect(err.code).toBe('user_agent_missing')
  expect(err.status).toBe(400)

  const down = createClient({ key: KEY, endpoint: ENDPOINT, ipHeader: 'cf-connecting-ip', fetch: (async () => { throw new Error('x') }) as typeof fetch })
  const net = await down.track('a', { visitor: { ip: '1.2.3.4', userAgent: 'x' } }).catch((e) => e)
  expect(net.code).toBe('NETWORK_ERROR')
  expect(net.status).toBeNull()
})
