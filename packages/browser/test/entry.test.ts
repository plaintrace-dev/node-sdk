import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
  const w = window as any
  for (const g of [w.px, w.pxAnalytics]) if (typeof g === 'function') g('stop')
  delete w.px
  delete w.pxAnalytics
  delete w.__px_tracker
  vi.resetModules()
})

test('init() returns undefined without a window (SSR)', async () => {
  const { initIn } = await import('../src/index.js')
  expect(initIn(undefined, { site: 's', endpoint: 'https://c.test' })).toBeUndefined()
})

test('init() twice returns the same tracker', async () => {
  const { init } = await import('../src/index.js')
  const fetchImpl = (async () => new Response('{}', { status: 202 })) as unknown as typeof fetch
  const a = init({ site: 's', endpoint: 'https://c.test', fetchImpl, storage: 'none' })
  expect(a).toBeDefined()
  expect(init({ site: 's', endpoint: 'https://c.test', fetchImpl })).toBe(a)
  a?.stop()
})

test('the script tag drains the px() stub queue in order, pageUrl first', async () => {
  const calls: string[] = []
  const w = window as any
  const stub: any = (...args: unknown[]) => stub.q.push(args)
  stub.q = [['track', 'early'], ['pageUrl', (h: string) => h.replace('/secret', '/s')]]
  stub.s = 1
  w.px = stub
  history.replaceState(null, '', '/secret')
  const { install } = await import('../src/script.js')
  const t = install(window, { site: 's', endpoint: 'https://c.test', fetchImpl: (async (u: string, i?: RequestInit) => {
    if (!u.includes('config')) calls.push(String(i?.body))
    return new Response('{}', { status: u.includes('config') ? 200 : 202 })
  }) as unknown as typeof fetch, storage: 'none' })
  expect(t).toBeDefined()
  await new Promise((r) => setTimeout(r, 3_200))
  const sent = calls.flatMap((c) => JSON.parse(c).events)
  expect(sent[0]).toMatchObject({ type: 'page_view', page: { url: 'https://a.com/s' } })
  expect(sent[1]).toMatchObject({ type: 'custom_event', name: 'early' })
  expect(typeof w.px).toBe('function')
}, 10_000)

test('a foreign window.px is left alone: the tracker becomes pxAnalytics', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const w = window as any
  const foreign = { someone: 'else' }
  w.px = foreign
  const { install } = await import('../src/script.js')
  install(window, { site: 's', endpoint: 'https://c.test', fetchImpl: (async () => new Response('{}', { status: 202 })) as unknown as typeof fetch, storage: 'none' })
  expect(w.px).toBe(foreign)
  expect(typeof w.pxAnalytics).toBe('function')
})

test('the README snippet leaves a foreign px function alone', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const w = window as any
  const foreign = function px() {}
  w.px = foreign
  const { SNIPPET } = await import('../src/snippet.js')
  new Function(SNIPPET)()
  expect(w.px).toBe(foreign)
  expect((foreign as any).q).toBeUndefined()
  const { install } = await import('../src/script.js')
  install(window, { site: 's', endpoint: 'https://c.test', fetchImpl: (async () => new Response('{}', { status: 202 })) as unknown as typeof fetch, storage: 'none' })
  expect(w.px).toBe(foreign)
  expect(typeof w.pxAnalytics).toBe('function')
})

test('the README snippet queues calls that install() then applies', async () => {
  const w = window as any
  const { SNIPPET } = await import('../src/snippet.js')
  new Function(SNIPPET)()
  w.px('track', 'early')
  expect(w.px.q).toHaveLength(1)
})

test('npm init first, then the script tag: one tracker, not two', async () => {
  const fetchImpl = (async () => new Response('{}', { status: 202 })) as unknown as typeof fetch
  const { init } = await import('../src/index.js')
  const { install } = await import('../src/script.js')
  const a = init({ site: 's', endpoint: 'https://c.test', fetchImpl, storage: 'none' })
  expect(install(window, { site: 's', endpoint: 'https://c.test', fetchImpl, storage: 'none' })).toBe(a)
  a?.stop()
})

test('calls made before init are kept up to 100 (a server render never calls init)', async () => {
  const bodies: string[] = []
  const fetchImpl = (async (u: string, i?: RequestInit) => {
    if (!u.includes('config')) bodies.push(String(i?.body))
    return new Response('{}', { status: u.includes('config') ? 200 : 202 })
  }) as unknown as typeof fetch
  const { init, track } = await import('../src/index.js')
  for (let k = 0; k < 150; k++) track(`e${k}`)
  const t = init({ site: 's', endpoint: 'https://c.test', fetchImpl, storage: 'none' })
  await new Promise((r) => setTimeout(r, 4_500))
  const custom = bodies.flatMap((b) => JSON.parse(b).events).filter((e: any) => e.type === 'custom_event')
  expect(custom).toHaveLength(100)
  expect(custom[0].name).toBe('e0')
  t?.stop()
}, 10_000)

test('a stopped npm tracker, or one for another site, is not reused by the script tag', async () => {
  const fetchImpl = (async () => new Response('{}', { status: 202 })) as unknown as typeof fetch
  const { init } = await import('../src/index.js')
  const { install } = await import('../src/script.js')
  const a = init({ site: 's', endpoint: 'https://c.test', fetchImpl, storage: 'none' })
  a?.stop()
  const b = install(window, { site: 's', endpoint: 'https://c.test', fetchImpl, storage: 'none' })
  expect(b).toBeDefined()
  expect(b).not.toBe(a)
  delete (window as any).px
  const c = install(window, { site: 'other', endpoint: 'https://c.test', fetchImpl, storage: 'none' })
  expect(c).not.toBe(b)
  b?.stop()
  c?.stop()
})
