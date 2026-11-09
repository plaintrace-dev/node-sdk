import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createTransport, type OutEvent } from '../src/transport.js'

interface Sent { body: { events: OutEvent[]; stats?: { dropped: number; retried: number; queued: number } }; signal?: AbortSignal }

let sent: Sent[]
let respond: () => Response | Promise<Response>
let beacons: string[]
let allowed: boolean
let visits: string[]

const fetchImpl = (async (_url: string, init: RequestInit) => {
  sent.push({ body: JSON.parse(String(init.body)), signal: init.signal ?? undefined })
  return respond()
}) as unknown as typeof fetch

const event = (i: number): OutEvent => ({ event_id: `id-${i}`, type: 'custom_event', occurred_at: new Date().toISOString(), name: 'x' })

function make(extra: Partial<Parameters<typeof createTransport>[0]> = {}) {
  return createTransport({
    endpoint: 'https://c.test', site: 's', sdk: { name: 'web', version: '1' },
    fetchImpl, beaconImpl: (_u, body) => (beacons.push(body), true),
    now: () => Date.now(), random: () => 0.5,
    schedule: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t) },
    maySend: () => allowed, held: () => false, onVisit: (id) => visits.push(id),
    ...extra,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  sent = []
  beacons = []
  visits = []
  allowed = true
  respond = () => new Response('{"visit_id":"v.sig","accepted":1,"rejected":[]}', { status: 202 })
})
afterEach(() => vi.useRealTimers())

test('batches events within one second, and passes the visit id on', async () => {
  const t = make()
  t.enqueue(event(1))
  t.enqueue(event(2))
  t.enqueue(event(3))
  expect(sent).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(1_000)
  expect(sent).toHaveLength(1)
  expect(sent[0]!.body.events).toHaveLength(3)
  expect(visits).toEqual(['v.sig'])
})

test('at most 100 events per batch', async () => {
  const t = make()
  for (let i = 0; i < 150; i++) t.enqueue(event(i))
  await vi.advanceTimersByTimeAsync(1_000)
  expect(sent.map((s) => s.body.events.length)).toEqual([100, 50])
})

test('an immediate event goes at once', async () => {
  make().enqueue(event(1), true)
  await vi.advanceTimersByTimeAsync(0)
  expect(sent).toHaveLength(1)
})

test('503 with Retry-After waits as told, and the next batch reports the retry', async () => {
  respond = () => new Response('{}', { status: 503, headers: { 'Retry-After': '7' } })
  const t = make()
  t.enqueue(event(1), true)
  await vi.advanceTimersByTimeAsync(0)
  respond = () => new Response('{"accepted":1}', { status: 202 })
  await vi.advanceTimersByTimeAsync(6_900)
  expect(sent).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(200)
  expect(sent).toHaveLength(2)
  expect(sent[1]!.body.events.map((e) => e.event_id)).toEqual(['id-1'])
  expect(sent[1]!.body.stats).toEqual({ dropped: 0, retried: 1, queued: 0 })
  t.enqueue(event(2), true)
  await vi.advanceTimersByTimeAsync(0)
  expect(sent[2]!.body.stats).toBeUndefined()
})

test('a 4xx is dropped and reported, not retried', async () => {
  respond = () => new Response('{"error":{"code":"invalid_json"}}', { status: 400 })
  const t = make()
  t.enqueue(event(1), true)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(sent).toHaveLength(1)
  respond = () => new Response('{}', { status: 202 })
  t.enqueue(event(2), true)
  await vi.advanceTimersByTimeAsync(0)
  expect(sent[1]!.body.stats?.dropped).toBe(1)
})

test('gives up after eight failed attempts and counts the loss', async () => {
  respond = () => { throw new TypeError('network') }
  const t = make()
  t.enqueue(event(1), true)
  await vi.advanceTimersByTimeAsync(30 * 60_000)
  expect(sent).toHaveLength(8)
  respond = () => new Response('{}', { status: 202 })
  t.enqueue(event(2), true)
  await vi.advanceTimersByTimeAsync(0)
  expect(sent.at(-1)!.body.events.map((e) => e.event_id)).toEqual(['id-2'])
  expect(sent.at(-1)!.body.stats?.dropped).toBe(1)
})

test('the retry queue holds at most 200 events', async () => {
  respond = () => new Response('{}', { status: 503, headers: { 'Retry-After': '60' } })
  const t = make()
  for (let i = 0; i < 100; i++) t.enqueue(event(i))
  await vi.advanceTimersByTimeAsync(1_000)
  for (let i = 100; i < 350; i++) t.enqueue(event(i))
  await vi.advanceTimersByTimeAsync(1_000)
  respond = () => new Response('{}', { status: 202 })
  await vi.advanceTimersByTimeAsync(60_000)
  const last = sent.slice(-2)
  expect(last.reduce((n, s) => n + s.body.events.length, 0)).toBe(200)
  expect(last[0]!.body.stats?.dropped).toBe(150)
})

test('flushes by beacon on hide, once even while backing off', async () => {
  respond = () => new Response('{}', { status: 503, headers: { 'Retry-After': '60' } })
  const t = make()
  t.enqueue(event(1), true)
  await vi.advanceTimersByTimeAsync(0)
  t.enqueue(event(2))
  t.flush(true)
  expect(beacons).toHaveLength(1)
  expect(JSON.parse(beacons[0]!).events.map((e: OutEvent) => e.event_id)).toEqual(['id-1', 'id-2'])
})

test('consent denied mid-flight: in-flight request aborted, nothing kept, nothing sent', async () => {
  let release!: (r: Response) => void
  respond = () => new Promise<Response>((r) => (release = r))
  const t = make()
  t.enqueue(event(1), true)
  await vi.advanceTimersByTimeAsync(0)
  t.enqueue(event(2))
  allowed = false
  t.cancel()
  expect(sent[0]!.signal?.aborted).toBe(true)
  release(new Response('{}', { status: 503 }))
  t.enqueue(event(3), true)
  await vi.advanceTimersByTimeAsync(120_000)
  expect(sent).toHaveLength(1)
  t.flush(true)
  expect(beacons).toHaveLength(0)
})

test('stats are reported once even when two sends overlap', async () => {
  respond = () => new Response('{}', { status: 503, headers: { 'Retry-After': '1' } })
  const t = make()
  t.enqueue(event(1), true)
  await vi.advanceTimersByTimeAsync(0)
  let release!: (r: Response) => void
  respond = () => new Promise<Response>((r) => (release = r))
  await vi.advanceTimersByTimeAsync(1_600) // the retry (jittered backoff 1.5 s) goes out carrying stats, and hangs
  respond = () => new Response('{}', { status: 202 })
  t.enqueue(event(2), true) // a second send while the first is in flight
  await vi.advanceTimersByTimeAsync(0)
  release(new Response('{}', { status: 202 }))
  await vi.advanceTimersByTimeAsync(0)
  const reported = sent.reduce((n, s) => n + (s.body.stats?.retried ?? 0), 0)
  expect(reported).toBe(1)
  t.enqueue(event(3), true)
  await vi.advanceTimersByTimeAsync(0)
  expect(sent.at(-1)!.body.stats).toBeUndefined()
})

test('stats taken by a failed send are reported by the next one', async () => {
  respond = () => new Response('{"error":{}}', { status: 400 })
  const t = make()
  t.enqueue(event(1), true)
  await vi.advanceTimersByTimeAsync(0) // dropped: 1
  respond = () => { throw new TypeError('network') }
  t.enqueue(event(2), true)
  await vi.advanceTimersByTimeAsync(0) // carries dropped 1, fails
  respond = () => new Response('{}', { status: 202 })
  await vi.advanceTimersByTimeAsync(5_000)
  expect(sent.at(-1)!.body.stats?.dropped).toBe(1)
})
