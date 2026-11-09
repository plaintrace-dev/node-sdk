import { describe, expect, test } from 'vitest'
import { createPrivacy, localStore, memoryStore } from '../src/privacy.js'
import { hostAllowed, loadConfig } from '../src/config.js'

const nav = (gpc = false, dnt = '0') => ({ globalPrivacyControl: gpc, doNotTrack: dnt }) as unknown as Navigator
const policy = { requireConsent: false, respectGpc: false, respectDnt: false }

describe('privacy gate', () => {
  test('collects by default and stops on denial', () => {
    const p = createPrivacy(memoryStore(), policy, nav())
    expect(p.mayCollect()).toBe(true)
    p.setConsent('denied')
    expect(p.mayCollect()).toBe(false)
    p.setConsent('unknown')
    expect(p.mayCollect()).toBe(true)
  })
  test('GPC and DNT only when the site opts in', () => {
    expect(createPrivacy(memoryStore(), policy, nav(true, '1')).mayCollect()).toBe(true)
    expect(createPrivacy(memoryStore(), { ...policy, respectGpc: true }, nav(true)).mayCollect()).toBe(false)
    expect(createPrivacy(memoryStore(), { ...policy, respectDnt: true }, nav(false, '1')).mayCollect()).toBe(false)
  })
  test('requireConsent waits for granted', () => {
    const store = memoryStore()
    const p = createPrivacy(store, { ...policy, requireConsent: true }, nav())
    expect(p.mayCollect()).toBe(false)
    p.setConsent('granted')
    expect(p.mayCollect()).toBe(true)
    expect(store.get('px.consent')).toBe('granted')
  })
  test('the owner opt-out', () => {
    const store = memoryStore()
    store.set('px.ignore', '1')
    expect(createPrivacy(store, policy, nav()).mayCollect()).toBe(false)
    expect(createPrivacy(store, policy, nav()).ignored()).toBe(true)
  })
})

test('localStore falls back to memory when storage refuses writes', () => {
  const real = window.localStorage
  const broken = { getItem: () => null, setItem: () => { throw new Error('quota') }, removeItem: () => {} }
  Object.defineProperty(window, 'localStorage', { value: broken, configurable: true })
  try {
    const s = localStore()
    s.set('a', '1')
    expect(s.get('a')).toBe('1')
  } finally {
    Object.defineProperty(window, 'localStorage', { value: real, configurable: true })
  }
})

describe('config', () => {
  const ok = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
  test('loads site settings', async () => {
    expect(await loadConfig('https://c.test', 's', ok({ allowed_domains: ['a.com'], redact_query_keys: ['ref'] }))).toEqual({ allowedDomains: ['a.com'], redactQueryKeys: ['ref'] })
  })
  test('unknown site and failures', async () => {
    expect(await loadConfig('https://c.test', 's', ok({}, 404))).toBe('unknown_site')
    expect(await loadConfig('https://c.test', 's', (async () => { throw new Error('x') }) as unknown as typeof fetch)).toBeNull()
    expect(await loadConfig('https://c.test', 's', ok({}, 500))).toBeNull()
  })
  test('hostAllowed', () => {
    expect(hostAllowed('app.a.com', ['a.com'])).toBe(true)
    expect(hostAllowed('a.com.evil.io', ['a.com'])).toBe(false)
    expect(hostAllowed('x', [])).toBe(true)
    expect(hostAllowed('b.com', ['*.b.com'])).toBe(true)
    expect(hostAllowed('', ['a.com'])).toBe(false)
  })
})

test('#px-ignore and #px-unignore set the opt-out and leave the address', async () => {
  const { applyIgnoreHash } = await import('../src/privacy.js')
  const store = memoryStore()
  history.replaceState(null, '', '/page?x=1#px-ignore')
  expect(applyIgnoreHash(window, store)).toBe('ignored')
  expect(store.get('px.ignore')).toBe('1')
  expect(location.hash).toBe('')
  expect(location.search).toBe('?x=1')
  history.replaceState(null, '', '/page#px-unignore')
  expect(applyIgnoreHash(window, store)).toBe('unignored')
  expect(store.get('px.ignore')).toBeNull()
  expect(applyIgnoreHash(window, store)).toBeNull()
})
