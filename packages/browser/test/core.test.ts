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

test('a soft page view still waiting for its title leaves in the exit beacon, not by fetch', async () => {
  const beaconed: any[] = []
  start({ beaconImpl: (_url, body) => (beaconed.push(...JSON.parse(body).events), true) })
  await vi.advanceTimersByTimeAsync(3_100)
  history.pushState(null, '', '/docs') // the title has not changed yet: the view waits
  window.dispatchEvent(new Event('pagehide'))
  await vi.advanceTimersByTimeAsync(5_000)
  expect(events().filter((e) => e.navigation === 'soft')).toHaveLength(0)
  expect(beaconed.filter((e) => e.navigation === 'soft')).toHaveLength(1)
})

test('time on an excluded page is not credited to the page before it, nor used as referrer', async () => {
  start({ excludePaths: ['/admin/*'] })
  await vi.advanceTimersByTimeAsync(3_100)
  window.dispatchEvent(new Event('pointerdown'))
  history.pushState(null, '', '/admin/users')
  await vi.advanceTimersByTimeAsync(3_000)
  window.dispatchEvent(new Event('pointerdown'))
  history.pushState(null, '', '/docs')
  await vi.advanceTimersByTimeAsync(3_000)
  const eng = events().filter((e) => e.type === 'engagement')
  expect(eng).toHaveLength(1) // the time on /pricing, sent when leaving it
  const docs = events().find((e) => e.page?.url === 'https://a.com/docs')
  expect(docs.referrer).toBeUndefined()
})

test('consent given after an SPA route change counts that page as soft, not as a load', async () => {
  const t = start({ requireConsent: true })
  await vi.advanceTimersByTimeAsync(3_100)
  history.pushState(null, '', '/docs')
  await vi.advanceTimersByTimeAsync(3_000)
  t.consent('granted')
  await vi.advanceTimersByTimeAsync(1_000)
  expect(events().filter((e) => e.type === 'page_view').map((e) => e.navigation)).toEqual(['soft'])
})

test('consent granted while the page is still prerendering counts it once, when shown', async () => {
  Object.defineProperty(document, 'prerendering', { value: true, configurable: true })
  try {
    const t = start({ requireConsent: true })
    t.consent('granted') // a consent banner script answering at startup
    await vi.advanceTimersByTimeAsync(3_100)
    expect(events().filter((e) => e.type === 'page_view')).toHaveLength(0)
    Object.defineProperty(document, 'prerendering', { value: false, configurable: true })
    document.dispatchEvent(new Event('prerenderingchange'))
    await vi.advanceTimersByTimeAsync(1_000)
    const views = events().filter((e) => e.type === 'page_view')
    expect(views.map((e) => e.navigation)).toEqual(['prerender'])
    expect(views[0].referrer).toBeUndefined()
  } finally {
    delete (document as any).prerendering
  }
})

test('heatmaps on: clicks go out with the page they were made on; off: no click events', async () => {
  config = () => new Response('{"allowed_domains":[],"redact_query_keys":[],"heatmaps":true}', { status: 200 })
  document.body.innerHTML = '<button id="buy">Buy</button>'
  start()
  await vi.advanceTimersByTimeAsync(3_100)
  const e = new MouseEvent('click', { bubbles: true, clientX: 1, clientY: 1 })
  Object.defineProperty(e, 'isTrusted', { value: true })
  document.getElementById('buy')!.dispatchEvent(e)
  await vi.advanceTimersByTimeAsync(3_000)
  const clicks = events().filter((x) => x.type === 'click')
  expect(clicks).toHaveLength(1)
  expect(clicks[0]).toMatchObject({ page: { url: 'https://a.com/pricing?plan=pro' }, click: { selector: '#buy' } })
  for (const t of trackers) t.stop()
  calls = []
  config = () => new Response('{"allowed_domains":[],"redact_query_keys":[]}', { status: 200 })
  start()
  await vi.advanceTimersByTimeAsync(3_100)
  document.getElementById('buy')!.dispatchEvent(e)
  await vi.advanceTimersByTimeAsync(3_000)
  expect(events().filter((x) => x.type === 'click')).toHaveLength(0)
})

const TOKEN = '01a1bf01-449d-788e-bd5c-6cb404a2c214.01a1bf01-4493-72f6-9c32-d6b950054b01.1794381597515.' + 'a'.repeat(43)

test('a heatmap link opens the overlay instead of measuring, and leaves no token in the address', async () => {
  config = () => new Response('{"allowed_domains":[],"redact_query_keys":[],"app_origin":"https://app.test"}', { status: 200 })
  history.replaceState(null, '', `/pricing#pt-heatmap=${TOKEN}&api=https%3A%2F%2Fapp.test`)
  const t = start()
  t.track('x')
  await vi.advanceTimersByTimeAsync(5_000)
  expect(calls).toHaveLength(0)
  expect(location.hash).toBe('')
  const script = [...document.querySelectorAll('script')].find((s) => s.src.includes('overlay.js'))
  expect(script?.src).toBe('https://c.test/v/0/overlay.js')
  expect((window as any).__ptOverlay).toMatchObject({ token: TOKEN, api: 'https://app.test' })
  script?.remove()
  delete (window as any).__ptOverlay
})

test('a heatmap link pointing at a non-https API is ignored', async () => {
  history.replaceState(null, '', '/pricing#pt-heatmap=s1.123.sig&api=http%3A%2F%2Fevil.test')
  start()
  await vi.advanceTimersByTimeAsync(5_000)
  expect([...document.querySelectorAll('script')].some((s) => s.src.includes('overlay.js'))).toBe(false)
  expect(events().map((e) => e.type)).toContain('page_view')
})

test('a heatmap link naming another API than the site\'s dashboard opens nothing', async () => {
  config = () => new Response('{"allowed_domains":[],"redact_query_keys":[],"app_origin":"https://app.test"}', { status: 200 })
  history.replaceState(null, '', `/pricing#pt-heatmap=${TOKEN}&api=https%3A%2F%2Fevil.test`)
  start()
  await vi.advanceTimersByTimeAsync(5_000)
  expect([...document.querySelectorAll('script')].some((s) => s.src.includes('overlay.js'))).toBe(false)
  expect(location.hash).toBe('')
})

test('a heatmap link with a malformed token opens nothing', async () => {
  config = () => new Response('{"allowed_domains":[],"redact_query_keys":[],"app_origin":"https://app.test"}', { status: 200 })
  history.replaceState(null, '', '/pricing#pt-heatmap=x&api=https%3A%2F%2Fapp.test')
  start()
  await vi.advanceTimersByTimeAsync(5_000)
  expect([...document.querySelectorAll('script')].some((s) => s.src.includes('overlay.js'))).toBe(false)
})

test('clicks alone do not keep the visit id alive (the collector does not extend a visit for them)', async () => {
  config = () => new Response('{"allowed_domains":[],"redact_query_keys":[],"heatmaps":true}', { status: 200 })
  document.body.innerHTML = '<button id="buy">Buy</button>'
  const t = start()
  await vi.advanceTimersByTimeAsync(3_100)
  expect(t.visitId()).toBe('v1.sig')
  await vi.advanceTimersByTimeAsync(29 * 60_000)
  const e = new MouseEvent('click', { bubbles: true })
  Object.defineProperty(e, 'isTrusted', { value: true })
  document.getElementById('buy')!.dispatchEvent(e)
  await vi.advanceTimersByTimeAsync(2 * 60_000)
  expect(t.visitId()).toBeNull()
})

test('the overlay asks for pages the way they were recorded, through pageUrl', async () => {
  config = () => new Response('{"allowed_domains":[],"redact_query_keys":[],"app_origin":"https://app.test"}', { status: 200 })
  history.replaceState(null, '', `/orders/8121#pt-heatmap=${TOKEN}&api=https%3A%2F%2Fapp.test`)
  start({ pageUrl: (href) => href.replace(/\/orders\/\d+/, '/orders/:n') })
  await vi.advanceTimersByTimeAsync(1_000)
  const o = (window as any).__ptOverlay
  expect(o.pathOf('https://a.com/orders/8121?x=1')).toBe('/orders/:n')
  expect(o.pathOf('https://a.com/users/0d7f2c1e-8b8a-4c55-9b7e-1f2a3b4c5d6e')).toBe('/users/:id')
  document.querySelectorAll('script').forEach((s) => s.src.includes('overlay.js') && s.remove())
  delete (window as any).__ptOverlay
})
