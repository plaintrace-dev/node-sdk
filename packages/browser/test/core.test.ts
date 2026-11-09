import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createTracker, type Tracker } from '../src/core.js'

interface Call { url: string; body: any }
let calls: Call[]
let config: () => Response | Promise<Response>
let trackers: Tracker[]

const fetchImpl = (async (url: string, init?: RequestInit) => {
  if (url.includes('/v1/config')) return config()
  calls.push({ url, body: JSON.parse(String(init?.body)) })
  return new Response('{"visit_id":"v1.sig","accepted":1,"rejected":[]}', { status: 202 })
}) as unknown as typeof fetch

const events = () => calls.flatMap((c) => c.body.events)

function start(o: Partial<Parameters<typeof createTracker>[0]> = {}) {
  const t = createTracker({ site: 's1', endpoint: 'https://c.test', sdk: 'web-npm', version: '0', fetchImpl, beaconImpl: () => true, storage: 'none', ...o })
  trackers.push(t)
  return t
}

beforeEach(() => {
  vi.useFakeTimers()
  calls = []
  trackers = []
  config = () => new Response('{"allowed_domains":[],"redact_query_keys":[]}', { status: 200 })
  history.replaceState(null, '', '/pricing?plan=pro')
  document.title = 'Pricing'
})
afterEach(() => {
  for (const t of trackers) t.stop()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('the first page view waits for the site settings, at most three seconds', async () => {
  config = () => new Promise(() => {})
  start()
  await vi.advanceTimersByTimeAsync(2_900)
  expect(calls).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(200)
  expect(events()).toMatchObject([{ type: 'page_view', navigation: 'load', page: { url: 'https://a.com/pricing?plan=pro', title: 'Pricing' } }])
  expect(calls[0]!.body).toMatchObject({ site_id: 's1', sdk: { name: 'web-npm' } })
})

test('a host the site does not allow sends nothing and warns once', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  config = () => new Response('{"allowed_domains":["other.com"]}', { status: 200 })
  const t = start()
  await vi.advanceTimersByTimeAsync(5_000)
  t.track('signup')
  await vi.advanceTimersByTimeAsync(5_000)
  expect(calls).toHaveLength(0)
  expect(warn).toHaveBeenCalledTimes(1)
})

test('an unknown site sends nothing', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  config = () => new Response('{}', { status: 404 })
  start()
  await vi.advanceTimersByTimeAsync(5_000)
  expect(calls).toHaveLength(0)
})

test('requireConsent: nothing until granted, then the page view', async () => {
  const t = start({ requireConsent: true })
  await vi.advanceTimersByTimeAsync(5_000)
  expect(calls).toHaveLength(0)
  t.consent('granted')
  await vi.advanceTimersByTimeAsync(0)
  expect(events().map((e) => e.type)).toEqual(['page_view'])
  t.consent('denied')
  t.track('later')
  await vi.advanceTimersByTimeAsync(5_000)
  expect(events().map((e) => e.type)).toEqual(['page_view'])
})

test('excluded paths send nothing', async () => {
  history.replaceState(null, '', '/admin/users')
  const t = start({ excludePaths: ['/admin/*'] })
  t.track('x')
  await vi.advanceTimersByTimeAsync(5_000)
  expect(calls).toHaveLength(0)
})

test('pageUrl rewrites the address; events are cleaned', async () => {
  history.replaceState(null, '', '/orders/8121?email=a@b.co')
  const t = start({ pageUrl: (href) => href.replace(/\/orders\/\d+/, '/orders/:n') })
  t.track('9 bad')
  t.track('signup', { plan: 'pro', password: 'x' })
  await vi.advanceTimersByTimeAsync(5_000)
  const [pv, signup] = events()
  expect(pv.page.url).toBe('https://a.com/orders/:n')
  expect(events()).toHaveLength(2)
  expect(signup).toMatchObject({ type: 'custom_event', name: 'signup', props: { plan: 'pro' } })
  expect(signup.props.password).toBeUndefined()
})

test('a soft navigation sends the old page engagement and a soft page view with the old page as referrer', async () => {
  start()
  await vi.advanceTimersByTimeAsync(3_100)
  window.dispatchEvent(new Event('pointerdown'))
  history.pushState(null, '', '/docs')
  await vi.advanceTimersByTimeAsync(3_000)
  const types = events().map((e) => `${e.type}:${e.navigation ?? ''}`)
  expect(types).toEqual(['page_view:load', 'engagement:', 'page_view:soft'])
  expect(events()[1].page.url).toBe('https://a.com/pricing?plan=pro')
  expect(events()[2].referrer).toBe('https://a.com/pricing?plan=pro')
})

test('visitId comes from the collector', async () => {
  const t = start()
  expect(t.visitId()).toBeNull()
  await vi.advanceTimersByTimeAsync(3_100)
  expect(t.visitId()).toBe('v1.sig')
})

test('an automated browser sends nothing unless debug is on', async () => {
  Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true })
  try {
    start().track('x')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(calls).toHaveLength(0)
    vi.spyOn(console, 'info').mockImplementation(() => {})
    start({ debug: true })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(events().map((e) => e.type)).toEqual(['page_view'])
  } finally {
    Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true })
  }
})

test('leaving sends the page engagement once, though pagehide and visibilitychange both fire', async () => {
  start({ beaconImpl: (url, body) => (calls.push({ url, body: JSON.parse(body) }), true) })
  await vi.advanceTimersByTimeAsync(3_100)
  window.dispatchEvent(new Event('pointerdown'))
  await vi.advanceTimersByTimeAsync(1_000)
  window.dispatchEvent(new Event('pagehide'))
  await vi.advanceTimersByTimeAsync(50)
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(5_000)
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  expect(events().filter((e) => e.type === 'engagement')).toHaveLength(1)
})
