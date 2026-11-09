import { expect, test } from 'vitest'
import { clientIp, headerClientIp } from '../src/ip.js'

const req = (headers: Record<string, string>) => new Request('https://a.com/', { headers })

const onWorkers = (headers: Record<string, string>) => Object.assign(req(headers), { cf: {} })

test('by default only trusts what the platform itself sets', () => {
  expect(clientIp(onWorkers({ 'cf-connecting-ip': '::ffff:1.2.3.4' }))).toBe('1.2.3.4')
  // Anywhere else a visitor can send these headers themselves.
  expect(clientIp(req({ 'cf-connecting-ip': '1.2.3.4' }))).toBeNull()
  expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4' }))).toBeNull()
})

test('a configured header is read; X-Forwarded-For from its right end', () => {
  expect(headerClientIp('x-real-ip')(req({ 'x-real-ip': '[2001:db8::1]:443' }))).toBe('2001:db8::1')
  expect(headerClientIp('x-forwarded-for')(req({ 'x-forwarded-for': '6.6.6.6, 1.2.3.4' }))).toBe('1.2.3.4')
  expect(headerClientIp('x-forwarded-for')(req({ 'x-forwarded-for': '1.2.3.4:5678' }))).toBe('1.2.3.4')
  expect(headerClientIp('x-real-ip')(req({ 'x-real-ip': 'bad' }))).toBeNull()
  expect(headerClientIp('x-real-ip')(req({}))).toBeNull()
})
