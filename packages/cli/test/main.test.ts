import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { run } from '../src/main.js'
import { HTML, NEXT_LAYOUT, pkg, project } from './fixtures.js'

const sdk = (async (input: string | URL | Request) => {
  if (String(input).endsWith('/v1/sdk')) return Response.json({ version: '0.1.0', path: '/v/0.1.0/t.js', integrity: 'sha384-abc' })
  return new Response('', { status: 404 })
}) as typeof fetch
const down = (async () => {
  throw new Error('offline')
}) as typeof fetch

function io() {
  const out: string[] = []
  return { out, log: (s: string) => out.push(s), text: () => out.join('\n') }
}

test('init writes the pinned tag with --yes and shows the diff', async () => {
  const dir = project({ 'package.json': pkg({ next: '15' }), 'app/layout.tsx': NEXT_LAYOUT })
  const o = io()
  const code = await run(['init', '--site', 's1', '--endpoint', 'https://c.test', '--dir', dir, '--yes'], { fetch: sdk, log: o.log, interactive: false })
  expect(code).toBe(0)
  expect(readFileSync(join(dir, 'app/layout.tsx'), 'utf8')).toContain('src="https://c.test/v/0.1.0/t.js"')
  expect(o.text()).toContain('+ ')
  expect(o.text()).toMatch(/Next\.js/)
})

test('--dry-run shows the change and writes nothing', async () => {
  const dir = project({ 'index.html': HTML })
  const o = io()
  expect(await run(['init', '--site', 's1', '--endpoint', 'https://c.test', '--dir', dir, '--dry-run'], { fetch: sdk, log: o.log, interactive: false })).toBe(0)
  expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(HTML)
  expect(o.text()).toContain('data-site="s1"')
})

test('not a terminal and no --yes: nothing is written', async () => {
  const dir = project({ 'index.html': HTML })
  expect(await run(['init', '--site', 's1', '--endpoint', 'https://c.test', '--dir', dir], { fetch: sdk, log: () => {}, interactive: false })).toBe(1)
  expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(HTML)
})

test('a second run changes nothing', async () => {
  const dir = project({ 'index.html': HTML })
  const args = ['init', '--site', 's1', '--endpoint', 'https://c.test', '--dir', dir, '--yes']
  await run(args, { fetch: sdk, log: () => {}, interactive: false })
  const after = readFileSync(join(dir, 'index.html'), 'utf8')
  const o = io()
  expect(await run(args, { fetch: sdk, log: o.log, interactive: false })).toBe(0)
  expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(after)
  expect(o.text()).toMatch(/already/)
})

test('collector unreachable: falls back to the latest script, with a warning', async () => {
  const dir = project({ 'index.html': HTML })
  const o = io()
  expect(await run(['init', '--site', 's1', '--endpoint', 'https://c.test', '--dir', dir, '--yes'], { fetch: down, log: o.log, interactive: false })).toBe(0)
  const html = readFileSync(join(dir, 'index.html'), 'utf8')
  expect(html).toContain('src="https://c.test/t.js"')
  expect(html).not.toContain('integrity')
  expect(o.text()).toMatch(/latest/)
})

test('unsupported framework: prints what to paste, exits 1, touches nothing', async () => {
  const dir = project({ 'package.json': pkg({ nuxt: '3' }) })
  const o = io()
  expect(await run(['init', '--site', 's1', '--endpoint', 'https://c.test', '--dir', dir, '--yes'], { fetch: sdk, log: o.log, interactive: false })).toBe(1)
  expect(o.text()).toMatch(/Nuxt/)
  expect(o.text()).toContain('data-site="s1"')
})

test('missing arguments and bad input', async () => {
  const o = io()
  expect(await run(['init', '--endpoint', 'https://c.test'], { fetch: sdk, log: o.log, interactive: false })).toBe(1)
  expect(o.text()).toMatch(/--site/)
  expect(await run(['init', '--site', 's1"><script>', '--endpoint', 'https://c.test'], { fetch: sdk, log: () => {}, interactive: false })).toBe(1)
  expect(await run(['init', '--site', 's1', '--endpoint', 'ftp://c.test'], { fetch: sdk, log: () => {}, interactive: false })).toBe(1)
  expect(await run(['help'], { fetch: sdk, log: () => {}, interactive: false })).toBe(0)
})

test('an endpoint host with markup characters is refused', async () => {
  const dir = project({ 'index.html': HTML })
  for (const e of ['http://x"onload="alert(1)"y.com', "https://a'b.com", 'https://{x}.com'])
    expect(await run(['init', '--site', 's1', '--endpoint', e, '--dir', dir, '--yes'], { fetch: sdk, log: () => {}, interactive: false })).toBe(1)
  expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(HTML)
})

test('uncovered files are named after a successful write', async () => {
  const dir = project({ 'package.json': pkg({ next: '15' }), 'app/layout.tsx': NEXT_LAYOUT, 'pages/old.tsx': 'x' })
  const o = io()
  expect(await run(['init', '--site', 's1', '--endpoint', 'https://c.test', '--dir', dir, '--yes'], { fetch: sdk, log: o.log, interactive: false })).toBe(0)
  expect(o.text()).toMatch(/not covered.*pages\//s)
})
