import { expect, test } from 'vitest'
import { diff } from '../src/diff.js'

test('a huge file is still diffed, without an n×m table', () => {
  const before = Array.from({ length: 20_000 }, (_, i) => `line ${i}`).join('\n')
  const after = before.replace('line 10000', 'line 10000\n<script></script>')
  const started = Date.now()
  const out = diff(before, after)
  expect(Date.now() - started).toBeLessThan(500)
  expect(out).toContain('+<script></script>')
  expect(out.split('\n').length).toBeLessThan(10)
})
