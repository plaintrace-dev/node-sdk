import { expect, test } from 'vitest'
import { uuidV7 } from '../src/uuid.js'

test('uuidV7 is a v7 id, increasing within one millisecond', () => {
  const ids = [uuidV7(1_800_000_000_000), uuidV7(1_800_000_000_000), uuidV7(1_800_000_000_000)]
  for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  expect([...ids].sort()).toEqual(ids)
  expect(new Set(ids).size).toBe(3)
  expect(ids[0]!.slice(0, 13)).toBe('01a3185c-5000')
})
