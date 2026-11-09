import { expect, test } from 'vitest'
import { createClient } from '../src/index.js'
import { ENDPOINT, KEY } from './helpers.js'

test('refuses a missing or wrong key and a missing endpoint', () => {
  expect(() => createClient({ key: '', endpoint: ENDPOINT })).toThrow(TypeError)
  expect(() => createClient({ key: 'pk_x', endpoint: ENDPOINT })).toThrow(TypeError)
  expect(() => createClient({ key: KEY, endpoint: '' })).toThrow(TypeError)
})
