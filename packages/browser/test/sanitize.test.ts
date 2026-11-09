import { expect, test } from 'vitest'
import { cleanProps, cleanTitle, cleanUrl, isValidName } from '../src/sanitize.js'

// The same inputs and expected values as the collector's Go tests (internal/sanitize):
// both sides apply one rule, so data is already clean before it leaves the browser.
test('cleanUrl redacts tokens, sensitive params and ids in the path', () => {
  expect(cleanUrl('https://a.com/reset/eyJhbGciOiJIUzI1NiJ9abcdefgh?token=x&q=ali@x.com&utm_source=gg#frag', [])).toBe(
    'https://a.com/reset/:id?q=%5Bredacted%5D&utm_source=gg',
  )
  expect(cleanUrl('https://u:p@a.com/users/0d7f2c1e-8b8a-4c55-9b7e-1f2a3b4c5d6e/orders/123456789', [])).toBe('https://a.com/users/:id/orders/:id')
  expect(cleanUrl('https://a.com/u/ali@x.com/blog/post-12', [])).toBe('https://a.com/u/:id/blog/post-12')
  expect(cleanUrl('https://a.com/?ref=x&Order_No=5&my_password_hint=y&page=2', ['order_no'])).toBe('https://a.com/?ref=x&page=2')
  expect(cleanUrl('javascript:alert(1)', [])).toBe('')
  expect(cleanUrl('not a url', [])).toBe('')
})

test('cleanTitle redacts emails and long digit runs', () => {
  expect(cleanTitle('Sipariş — ali@x.com')).toBe('Sipariş — [redacted]')
  expect(cleanTitle('Call +90 532 123 45 67 now')).toBe('Call [redacted] now')
  expect(cleanTitle('Code 1234567 ok')).toBe('Code 1234567 ok')
  expect(cleanTitle('x'.repeat(300))).toHaveLength(256)
})

test('cleanProps keeps valid, non-sensitive properties', () => {
  expect(cleanProps({ plan: 'pro', seats: 5, password: 'x', px_a: 1, ok: true, none: null, 'bad key': 'v', inf: Infinity })).toEqual({
    plan: 'pro',
    seats: 5,
    ok: true,
    none: null,
  })
  const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${String(i).padStart(2, '0')}`, 'v']))
  expect(Object.keys(cleanProps(many) ?? {})).toHaveLength(32)
  expect(cleanProps({})).toBeUndefined()
})

test('isValidName', () => {
  expect(isValidName('checkout_completed')).toBe(true)
  expect(isValidName('9 bad')).toBe(false)
  expect(isValidName('a'.repeat(65))).toBe(false)
  expect(isValidName(42)).toBe(false)
})
