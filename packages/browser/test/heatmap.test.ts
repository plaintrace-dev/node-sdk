import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createClicks, type ClickRecord } from '../src/heatmap.js'

let got: ClickRecord[]
let stop: (() => void) | undefined

beforeEach(() => {
  vi.useFakeTimers()
  got = []
  document.body.innerHTML = '<button id="buy">Buy</button><span id="price">€9</span><input type="password" id="pw"><input autocomplete="cc-number" id="cc">'
  for (const e of document.querySelectorAll('*'))
    (e as HTMLElement).getBoundingClientRect = () => ({ left: 100, top: 200, width: 200, height: 50, right: 300, bottom: 250, x: 100, y: 200, toJSON() {} }) as DOMRect
})
afterEach(() => {
  stop?.()
  vi.useRealTimers()
})

const start = () => {
  const c = createClicks(window, (r) => got.push(r))
  stop = c.stop
  return c
}
const click = (id: string, x = 150, y = 210) => {
  const e = new MouseEvent('click', { bubbles: true, clientX: x, clientY: y })
  Object.defineProperty(e, 'isTrusted', { value: true })
  document.getElementById(id)!.dispatchEvent(e)
}

test('records the element and the position in its box, a second later', async () => {
  start()
  click('buy', 150, 210) // 50/200 across, 10/50 down
  expect(got).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(1_000)
  expect(got).toHaveLength(1)
  expect(got[0]!.click).toMatchObject({ selector: '#buy', x: 250, y: 200, viewport: 'desktop', rage: false })
  expect(got[0]!.page.url).toContain('http')
})

test('a click that changes nothing is dead; one followed by a DOM change is not', async () => {
  start()
  click('price')
  await vi.advanceTimersByTimeAsync(1_000)
  expect(got[0]!.click.dead).toBe(true)
  click('buy')
  document.body.appendChild(document.createElement('div'))
  await vi.advanceTimersByTimeAsync(1_000)
  expect(got[1]!.click.dead).toBe(false)
})

test('three clicks in the same spot within 700 ms: the third onwards are rage clicks', async () => {
  start()
  click('price', 150, 210)
  await vi.advanceTimersByTimeAsync(100)
  click('price', 155, 212)
  await vi.advanceTimersByTimeAsync(100)
  click('price', 152, 211)
  await vi.advanceTimersByTimeAsync(2_000)
  expect(got.map((g) => g.click.rage)).toEqual([false, false, true])
})

test('password and card fields are never recorded; synthetic clicks neither', async () => {
  start()
  click('pw')
  click('cc')
  document.getElementById('buy')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await vi.advanceTimersByTimeAsync(2_000)
  expect(got).toHaveLength(0)
})

test('at most 50 clicks per page view, counting again after newPage()', async () => {
  const c = start()
  for (let i = 0; i < 60; i++) {
    click('buy', 100 + i * 2, 210)
    await vi.advanceTimersByTimeAsync(800)
  }
  await vi.advanceTimersByTimeAsync(2_000)
  expect(got).toHaveLength(50)
  c.newPage()
  click('buy')
  await vi.advanceTimersByTimeAsync(1_000)
  expect(got).toHaveLength(51)
})

test('leaving the page sends the clicks still waiting, as not dead', async () => {
  const c = start()
  click('price')
  c.flushPending()
  expect(got).toHaveLength(1)
  expect(got[0]!.click.dead).toBe(false)
  await vi.advanceTimersByTimeAsync(2_000)
  expect(got).toHaveLength(1)
})

test('small screens are mobile, mid-size tablet', async () => {
  start()
  Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true })
  click('buy')
  Object.defineProperty(window, 'innerWidth', { value: 900, configurable: true })
  click('buy', 200, 240)
  await vi.advanceTimersByTimeAsync(1_000)
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true })
  expect(got.map((g) => g.click.viewport)).toEqual(['mobile', 'tablet'])
})

test('a click that selects text did something: not dead', async () => {
  let text = ''
  const sel = vi.spyOn(window, 'getSelection').mockImplementation(() => ({ isCollapsed: text === '', toString: () => text }) as unknown as Selection)
  start()
  click('price')
  text = '€9' // the click (a double click, a drag) selected the price
  await vi.advanceTimersByTimeAsync(1_000)
  expect(got[0]!.click.dead).toBe(false)
  sel.mockRestore()
})

test('text already selected before the click does not hide a dead click', async () => {
  const sel = vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false, toString: () => 'earlier', rangeCount: 1, getRangeAt: () => ({ startContainer: document.body, startOffset: 0, endContainer: document.body, endOffset: 1 }) } as unknown as Selection)
  start()
  click('price')
  await vi.advanceTimersByTimeAsync(1_000)
  expect(got[0]!.click.dead).toBe(true)
  sel.mockRestore()
})
