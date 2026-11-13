import { expect, test } from 'vitest'
import { cleanProps, cleanTitle, cleanUrl, isValidName, storedPath } from '../src/sanitize.js'

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
  })
  const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${String(i).padStart(2, '0')}`, 'v']))
  expect(Object.keys(cleanProps(many) ?? {})).toHaveLength(32)
  expect(cleanProps({})).toBeUndefined()
})

test('null properties are dropped (the collector drops them) and take no slot of the 32', () => {
  const nulls = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`a${String(i).padStart(2, '0')}`, null]))
  expect(cleanProps({ ...nulls, zplan: 'pro' })).toEqual({ zplan: 'pro' })
})

test('a truncated URL never ends inside a %-escape', () => {
  const url = cleanUrl('https://a.com/?q=' + 'é'.repeat(400), [])
  expect(url.length).toBeLessThanOrEqual(1024)
  expect(url).not.toMatch(/%[0-9A-F]?$/i)
})

test('isValidName', () => {
  expect(isValidName('checkout_completed')).toBe(true)
  expect(isValidName('9 bad')).toBe(false)
  expect(isValidName('a'.repeat(65))).toBe(false)
  expect(isValidName(42)).toBe(false)
})

test('storedPath is the path as the collector stores it (Go sanitize.URL)', () => {
  expect(storedPath('/orders/123456789/items')).toBe('/orders/:id/items')
  expect(storedPath('/users/0d7f2c1e-8b8a-4c55-9b7e-1f2a3b4c5d6e')).toBe('/users/:id')
  expect(storedPath('/caf%C3%A9')).toBe('/café')
  expect(storedPath('/u/ali@x.com')).toBe('/u/:id')
  expect(storedPath('/blog/post-12')).toBe('/blog/post-12')
  expect(storedPath('')).toBe('/')
})

test('a truncated URL never ends inside a multi-byte character', () => {
  // '€' is three bytes (%E2%82%AC): a cut can leave %E2%82, valid escapes but not UTF-8.
  for (let pad = 0; pad < 9; pad++) {
    const url = cleanUrl('https://a.com/?' + 'p'.repeat(pad) + '=' + '€'.repeat(400), [])
    expect(() => decodeURIComponent(url), url.slice(-12)).not.toThrow()
  }
})

test('an address that was not cut keeps its escapes as they were', () => {
  expect(cleanUrl('https://a.com/foo%C3', [])).toBe('https://a.com/foo%C3')
})

test('long readable page names are kept; tokens are still hidden (same rule as the collector)', () => {
  for (const slug of ['resize-for-instagram-profile-picture', 'how-to-resize-image-without-losing-quality', 'instagram-image-size-guide-2026', 'png_to_webp_converter_online', '1920x1080-wallpaper-download-free', 'how-to-use-gpt4o-for-sql-queries']) {
    expect(cleanUrl(`https://a.com/guides/${slug}`, [])).toBe(`https://a.com/guides/${slug}`)
    expect(storedPath(`/guides/${slug}`)).toBe(`/guides/${slug}`)
  }
  for (const tok of ['aB3dE5fG7hJ9kL1mN3pQ5rS7', '3f9a8b7c6d5e4f3a2b1c0d9e8f7a', 'reset-k3j4h5g6f7d8s9a0q1w2e3r4', 'eyJhbGciOiJIUzI1NiJ9-abc_DEF', 'ab3k-9xqz-mm2p-7rtw-lq8v', 'dfxyuokixugpbnrh-bfsvxktajoaaevik']) {
    expect(cleanUrl(`https://a.com/x/${tok}`, [])).toBe('https://a.com/x/:id')
    expect(storedPath(`/x/${tok}`)).toBe('/x/:id')
  }
})
