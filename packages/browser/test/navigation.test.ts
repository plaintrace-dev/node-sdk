import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { watchNavigation, type NavKind } from '../src/navigation.js'

let stop: (() => void) | undefined
beforeEach(() => {
  vi.useFakeTimers()
  history.replaceState(null, '', '/a')
})
afterEach(() => {
  vi.restoreAllMocks()
  stop?.()
  stop = undefined
  vi.useRealTimers()
  delete (window as { navigation?: unknown }).navigation
  delete (document as { prerendering?: unknown }).prerendering
})

function watch(): NavKind[] {
  const seen: NavKind[] = []
  stop = watchNavigation(window, (k) => seen.push(k)).stop
  return seen
}

test('the first page is a load', () => {
  expect(watch()).toEqual(['load'])
})

test('history: a path change is soft, a query-only replace is nothing, back is soft', () => {
  const seen = watch()
  history.pushState(null, '', '/b')
  vi.advanceTimersByTime(2_000)
  history.replaceState(null, '', '/b?x=1')
  vi.advanceTimersByTime(2_000)
  history.pushState(null, '', '/c')
  vi.advanceTimersByTime(2_000)
  history.replaceState(null, '', '/b')
  window.dispatchEvent(new PopStateEvent('popstate'))
  vi.advanceTimersByTime(2_000)
  expect(seen).toEqual(['load', 'soft', 'soft', 'soft'])
})

test('navigation dedup: with the Navigation API, history is not patched', () => {
  const api = new EventTarget()
  ;(window as { navigation?: unknown }).navigation = api
  const seen = watch()
  history.pushState(null, '', '/b')
  api.dispatchEvent(new Event('navigatesuccess'))
  vi.advanceTimersByTime(2_000)
  expect(seen).toEqual(['load', 'soft'])
})

test('a soft page view waits for the new title, at most two seconds', () => {
  const seen = watch()
  history.pushState(null, '', '/b')
  vi.advanceTimersByTime(1_000)
  expect(seen).toEqual(['load'])
  vi.advanceTimersByTime(1_000)
  expect(seen).toEqual(['load', 'soft'])
})

test('settle() sends a waiting page view at once', () => {
  const seen: NavKind[] = []
  const w = watchNavigation(window, (k) => seen.push(k))
  stop = w.stop
  history.pushState(null, '', '/b')
  w.settle()
  expect(seen).toEqual(['load', 'soft'])
})

test('bfcache restore', () => {
  const seen = watch()
  window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
  window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }))
  expect(seen).toEqual(['load', 'restore'])
})

test('a prerendered page counts when it is shown', () => {
  Object.defineProperty(document, 'prerendering', { value: true, configurable: true })
  const seen = watch()
  expect(seen).toEqual([])
  Object.defineProperty(document, 'prerendering', { value: false, configurable: true })
  document.dispatchEvent(new Event('prerenderingchange'))
  expect(seen).toEqual(['prerender'])
})

function navEntry(e: Record<string, unknown>) {
  vi.spyOn(performance, 'getEntriesByType').mockImplementation((t: string) => (t === 'navigation' ? [e as unknown as PerformanceEntry] : []))
}

test('a back/forward page served from the browser cache is not a load', () => {
  navEntry({ type: 'back_forward', transferSize: 0 })
  expect(watch()).toEqual(['restore'])
})

test('a back/forward page fetched again is a load', () => {
  navEntry({ type: 'back_forward', transferSize: 5_000 })
  expect(watch()).toEqual(['load'])
})

test('a page delivered from a speculation prefetch is not a load', () => {
  navEntry({ type: 'navigate', transferSize: 0, deliveryType: 'navigational-prefetch' })
  expect(watch()).toEqual(['prerender'])
})

test('a page delivered from the HTTP cache is not a load', () => {
  navEntry({ type: 'navigate', transferSize: 0, deliveryType: 'cache' })
  expect(watch()).toEqual(['restore'])
})
