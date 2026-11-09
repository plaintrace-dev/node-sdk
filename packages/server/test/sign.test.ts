import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { sign, signingSecret } from '../src/sign.js'

interface Vector { key: string; t: number; method: string; path: string; body_utf8: string; expected_header: string }

// Shared with the Go collector's tests: both sides must sign the same bytes the same way.
const vectors: Vector[] = JSON.parse(
  readFileSync(new URL('./fixtures/signature-vectors.json', import.meta.url), 'utf8'),
)

test('signs exactly like the collector', async () => {
  expect(vectors).toHaveLength(3)
  for (const v of vectors) {
    const secret = await signingSecret(v.key)
    expect(await sign(secret, v.t, v.method, v.path, new TextEncoder().encode(v.body_utf8))).toBe(v.expected_header)
  }
})
