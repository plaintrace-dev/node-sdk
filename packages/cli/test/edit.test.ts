import { expect, test } from 'vitest'
import { applyEdit } from '../src/edit.js'
import { snippet } from '../src/snippet.js'
import { HTML, NEXT_LAYOUT, ROOT_TSX } from './fixtures.js'

const pinned = { site: 's1', src: 'https://c.test/v/0.1.0/t.js', integrity: 'sha384-abc' }

test('HTML: stub and pinned tag before </head>', () => {
  const r = applyEdit('html', HTML, snippet('html', pinned))
  expect(r.ok).toBe(true)
  if (!r.ok) return
  expect(r.content).toContain('p.s=1')
  expect(r.content).toMatch(/<script async src="https:\/\/c\.test\/v\/0\.1\.0\/t\.js" integrity="sha384-abc" crossorigin="anonymous" data-site="s1"><\/script>\n  <\/head>/)
})

test('already installed: no change', () => {
  const once = applyEdit('html', HTML, snippet('html', pinned))
  if (!once.ok) throw new Error()
  expect(applyEdit('html', once.content, snippet('html', pinned))).toEqual({ ok: false, reason: 'already_installed' })
})

test('no anchor, or more than one: no change', () => {
  expect(applyEdit('html', '<div></div>', snippet('html', pinned))).toEqual({ ok: false, reason: 'no_anchor' })
  expect(applyEdit('html', '<head></head><head></head>', snippet('html', pinned))).toEqual({ ok: false, reason: 'ambiguous_anchor' })
})

test('Next.js App Router: imports Script once and adds it before </body>', () => {
  const r = applyEdit('next-app', NEXT_LAYOUT, snippet('next-app', pinned))
  if (!r.ok) throw new Error(r.reason)
  expect(r.content.startsWith("import Script from 'next/script'\n")).toBe(true)
  expect(r.content).toContain('<Script src="https://c.test/v/0.1.0/t.js" integrity="sha384-abc" crossOrigin="anonymous" data-site="s1" strategy="afterInteractive" />')
  expect(r.content.indexOf('<Script')).toBeLessThan(r.content.indexOf('</body>'))
  // A layout that already imports Script keeps its one import.
  const again = applyEdit('next-app', `import Script from 'next/script'\n${NEXT_LAYOUT}`, snippet('next-app', pinned))
  if (!again.ok) throw new Error()
  expect(again.content.match(/from 'next\/script'/g)).toHaveLength(1)
})

test('JSX root: a JSX-valid tag before </head>', () => {
  const r = applyEdit('jsx', ROOT_TSX, snippet('jsx', pinned))
  if (!r.ok) throw new Error(r.reason)
  expect(r.content).toContain('<script async src="https://c.test/v/0.1.0/t.js" integrity="sha384-abc" crossOrigin="anonymous" data-site="s1" />')
  expect(r.content).not.toContain('p.s=1')
})

test('Astro: is:inline so Astro does not bundle it', () => {
  const r = applyEdit('astro', '---\n---\n' + HTML, snippet('astro', pinned))
  if (!r.ok) throw new Error(r.reason)
  expect(r.content).toContain('<script is:inline async src=')
})

test('Next.js Pages Router: a new _document when there is none', () => {
  const r = applyEdit('next-pages', '', snippet('next-pages', pinned))
  if (!r.ok) throw new Error(r.reason)
  expect(r.content).toContain("import { Html, Head, Main, NextScript } from 'next/document'")
  expect(r.content).toContain('data-site="s1"')
})

test('latest (unpinned) has no integrity attribute', () => {
  expect(snippet('html', { site: 's1', src: 'https://c.test/t.js' })).not.toContain('integrity')
})

test("create-next-app's self-closing <Head /> is expanded", () => {
  const doc = `import { Html, Head, Main, NextScript } from 'next/document'\nexport default function Document() {\n  return (\n    <Html lang="en">\n      <Head />\n      <body><Main /><NextScript /></body>\n    </Html>\n  )\n}\n`
  const r = applyEdit('next-pages', doc, snippet('next-pages', pinned))
  if (!r.ok) throw new Error(r.reason)
  expect(r.content).toMatch(/<Head><script async [^\n]*\/><\/Head>/)
})

test("'use client' stays first despite comments and CRLF", () => {
  for (const head of ["'use client';\r\n", "// header\n'use client'\n", "'use client' // note\n"]) {
    const r = applyEdit('next-app', head + NEXT_LAYOUT, snippet('next-app', pinned))
    if (!r.ok) throw new Error(r.reason)
    expect(r.content.startsWith(head)).toBe(true)
    expect(r.content).toContain(`${head}import Script from 'next/script'\n`)
  }
})

test('another vendor using data-site (Fathom) is not mistaken for ours', () => {
  const fathom = HTML.replace('</head>', '<script src="https://cdn.usefathom.com/script.js" data-site="ABCDE" defer></script>\n  </head>')
  expect(applyEdit('html', fathom, snippet('html', pinned)).ok).toBe(true)
})

test('CRLF files stay CRLF; tab-indented files get tabs', () => {
  const crlf = HTML.replace(/\n/g, '\r\n')
  const r = applyEdit('html', crlf, snippet('html', pinned))
  if (!r.ok) throw new Error(r.reason)
  expect(r.content.replace(/\r\n/g, '')).not.toContain('\n')
  const tabs = '<html>\n\t<head>\n\t</head>\n</html>\n'
  const t = applyEdit('html', tabs, snippet('html', pinned))
  if (!t.ok) throw new Error(t.reason)
  expect(t.content).toContain('\t\t<script async src=')
  expect(t.content).not.toMatch(/\t {2}/)
})

test('a BOM stays the first character after the import is added', () => {
  const r = applyEdit('next-app', '﻿' + NEXT_LAYOUT, snippet('next-app', pinned))
  if (!r.ok) throw new Error(r.reason)
  expect(r.content.startsWith("﻿import Script from 'next/script'\n")).toBe(true)
})

test('next/script imported under another name: that name is used, no second import', () => {
  const r = applyEdit('next-app', `import NextScript from 'next/script'\n${NEXT_LAYOUT}`, snippet('next-app', pinned))
  if (!r.ok) throw new Error(r.reason)
  expect(r.content.match(/from 'next\/script'/g)).toHaveLength(1)
  expect(r.content).toContain('<NextScript src="https://c.test/v/0.1.0/t.js"')
  expect(r.content).not.toContain('<Script ')
})

test.each([
  ["import Script, { type ScriptProps } from 'next/script'", '<Script src='],
  ["import { default as S } from 'next/script'", '<S src='],
  ["import * as NS from 'next/script'", '<NS.default src='],
])('an existing next/script import (%s) is reused, never imported twice', (line, tag) => {
  const r = applyEdit('next-app', `${line}\n${NEXT_LAYOUT}`, snippet('next-app', pinned))
  if (!r.ok) throw new Error(r.reason)
  expect(r.content.match(/from 'next\/script'/g)).toHaveLength(1)
  expect(r.content).toContain(tag)
})

test('a commented-out next/script import does not count', () => {
  const r = applyEdit('next-app', `// import Foo from 'next/script'\n${NEXT_LAYOUT}`, snippet('next-app', pinned))
  if (!r.ok) throw new Error(r.reason)
  expect(r.content).toContain("import Script from 'next/script'\n")
  expect(r.content).toContain('<Script src=')
})

test('a tag installed under a renamed component is recognised', () => {
  const installed = NEXT_LAYOUT.replace('</body>', '<NextScript src="https://c.test/v/0.1.0/t.js" data-site="s1" /></body>')
  expect(applyEdit('next-app', `import NextScript from 'next/script'\n${installed}`, snippet('next-app', pinned))).toEqual({ ok: false, reason: 'already_installed' })
})
