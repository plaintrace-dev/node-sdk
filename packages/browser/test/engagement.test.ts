import { expect, test } from 'vitest'
import { createEngagement } from '../src/engagement.js'

function setVisibility(v: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

test('active time counts five seconds after each interaction', () => {
  let t = 0
  setVisibility('visible')
  const e = createEngagement(window, () => t, () => 40)
  e.start()
  window.dispatchEvent(new Event('pointerdown'))
  t = 3_000
  window.dispatchEvent(new Event('keydown'))
  t = 10_000
  expect(e.collect()).toEqual({ active_ms: 8_000, visible_ms: 10_000, scroll_depth: 40 })
  e.stop()
})

test('hidden time is not counted, and collect() resets', () => {
  let t = 0
  setVisibility('visible')
  const e = createEngagement(window, () => t, () => 0)
  e.start()
  t = 2_000
  setVisibility('hidden')
  t = 9_000
  setVisibility('visible')
  t = 10_000
  expect(e.collect()?.visible_ms).toBe(3_000)
  t = 10_000
  expect(e.collect()).toBeNull()
  e.stop()
})
