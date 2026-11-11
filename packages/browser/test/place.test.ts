import { expect, test } from 'vitest'
import { parseData, place } from '../src/overlay/place.js'

const box = { left: 100, top: 1000, width: 200, height: 40 }

test('cells land inside their element, on the page; missing elements are counted, not drawn', () => {
  const found = new Map([['#buy', box]])
  const r = place(
    [
      { selector: '#buy', cx: 0, cy: 0, count: 3 },
      { selector: '#buy', cx: 19, cy: 19, count: 1 },
      { selector: '#gone', cx: 5, cy: 5, count: 4 },
    ],
    50,
    (s) => found.get(s) ?? null,
  )
  // Cell centres: (0.5 × 50)/1000 and (19.5 × 50)/1000 of the box.
  expect(r.points).toEqual([
    { x: 105, y: 1001, count: 3 },
    { x: 295, y: 1039, count: 1 },
  ])
  expect(r.placed).toBe(4)
  expect(r.unplaced).toBe(4)
  expect(r.missing).toEqual([{ selector: '#gone', count: 4 }])
})

test('an element with no size (hidden now) is not placed either', () => {
  const r = place([{ selector: '#x', cx: 1, cy: 1, count: 2 }], 50, () => ({ left: 0, top: 0, width: 0, height: 0 }))
  expect(r.unplaced).toBe(2)
  expect(r.points).toEqual([])
})

test('data from the API is coerced: numbers stay numbers, nothing else gets through', () => {
  const d = parseData({
    views: '<img src=x onerror=alert(1)>',
    small: 'yes',
    cell_size: 50,
    clicks: [{ selector: '#a', cx: '1', cy: 2, count: '<b>' }, { selector: 5, cx: 0, cy: 0, count: 3 }, { selector: '#b', cx: 1, cy: 1, count: 4 }],
    elements: [{ selector: '#b', clicks: '7', rage: 'x', dead: 1 }],
    scroll_reach: ['0.5', 2, -1],
  })
  expect(d.views).toBe(0)
  expect(d.small).toBe(false)
  expect(d.clicks).toEqual([{ selector: '#b', cx: 1, cy: 1, count: 4 }])
  expect(d.elements).toEqual([{ selector: '#b', clicks: 7, rage: 0, dead: 1 }])
  expect(d.scroll_reach).toEqual([0.5, 1, 0])
})
