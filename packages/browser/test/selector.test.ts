import { beforeEach, expect, test } from 'vitest'
import { resolve, selectorFor, textHash } from '../src/selector.js'

beforeEach(() => {
  document.body.innerHTML = ''
})

const el = (html: string, pick: string) => {
  document.body.innerHTML = html
  return document.querySelector(pick)!
}

test('a stable id is enough', () => {
  const b = el('<main><button id="buy-now">Buy</button></main>', 'button')
  expect(selectorFor(b)).toBe('#buy-now')
  expect(resolve('#buy-now', document)).toBe(b)
})

test('generated ids and classes are skipped; test attributes are used', () => {
  const b = el('<div><button id=":r1f:" class="css-1x2y3z sc-a1b2c3" data-testid="checkout">Pay</button></div>', 'button')
  expect(selectorFor(b)).toBe('button[data-testid="checkout"]')
  expect(resolve(selectorFor(b), document)).toBe(b)
})

test('meaningful classes, climbing until the selector is unique', () => {
  document.body.innerHTML = '<nav class="top"><a class="link">Docs</a></nav><footer class="bottom"><a class="link">Docs</a></footer>'
  const second = document.querySelectorAll('a.link')[1]!
  const s = selectorFor(second)
  expect(document.querySelectorAll('a.link')).toHaveLength(2)
  expect(resolve(s, document)).toBe(second)
  expect(s).toContain('footer.bottom')
})

test('buttons without ids are told apart by a hash of their text, never the text itself', () => {
  document.body.innerHTML = '<div><button>Start free trial</button><button>Talk to sales</button></div>'
  const sales = document.querySelectorAll('button')[1]!
  const s = selectorFor(sales)
  expect(s).toContain(`:t(${textHash('Talk to sales')})`)
  expect(s.toLowerCase()).not.toContain('sales')
  expect(resolve(s, document)).toBe(sales)
})

test('nth-of-type only as a last resort; at most 256 characters', () => {
  document.body.innerHTML = '<ul><li><span></span></li><li><span></span></li></ul>'
  const second = document.querySelectorAll('span')[1]!
  const s = selectorFor(second)
  expect(s).toMatch(/nth-of-type\(2\)/)
  expect(resolve(s, document)).toBe(second)
  document.body.innerHTML = `<div class="${'a'.repeat(300)}"><i></i><i></i></div>`
  expect(selectorFor(document.querySelectorAll('i')[1]!).length).toBeLessThanOrEqual(256)
})

test('a selector that no longer matches resolves to null', () => {
  document.body.innerHTML = '<p>gone</p>'
  expect(resolve('#buy-now', document)).toBeNull()
  expect(resolve('button:t(000000)', document)).toBeNull()
})

test('values that look like data, not code, are never used: ids with numbers, emails, long values', () => {
  const b = el('<div><button id="order-48213" data-testid="row-12345" data-track="jane@x.com" class="buy">Buy</button></div>', 'button')
  const s = selectorFor(b)
  expect(s).not.toMatch(/48213|12345|jane|x\.com/)
  expect(resolve(s, document)).toBe(b)
  const c = el(`<div><span data-testid="${'a'.repeat(41)}"></span><span></span></div>`, 'span')
  expect(selectorFor(c)).not.toContain('a'.repeat(41))
})
