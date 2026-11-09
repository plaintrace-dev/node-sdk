import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
  const w = window as any
  for (const g of [w.px, w.pxAnalytics]) if (typeof g === 'function') g('stop')
  delete w.px
  delete w.pxAnalytics
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
