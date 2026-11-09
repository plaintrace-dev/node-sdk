import { expect, test } from 'vitest'
import { detect } from '../src/detect.js'
import { HTML, NEXT_LAYOUT, ROOT_TSX, pkg, project } from './fixtures.js'

test.each([
  ['Next.js App Router', { 'package.json': pkg({ next: '15' }), 'app/layout.tsx': NEXT_LAYOUT }, 'next-app', 'app/layout.tsx'],
  ['Next.js App Router in src/', { 'package.json': pkg({ next: '15' }), 'src/app/layout.jsx': NEXT_LAYOUT }, 'next-app', 'src/app/layout.jsx'],
  ['Next.js Pages Router', { 'package.json': pkg({ next: '15' }), 'pages/index.tsx': 'x' }, 'next-pages', 'pages/_document.tsx'],
  ['React Router', { 'package.json': pkg({ '@react-router/dev': '7' }), 'app/root.tsx': ROOT_TSX }, 'jsx', 'app/root.tsx'],
  ['SvelteKit', { 'package.json': pkg({ '@sveltejs/kit': '2' }), 'src/app.html': HTML }, 'html', 'src/app.html'],
  ['Astro', { 'package.json': pkg({ astro: '5' }), 'src/layouts/Base.astro': '---\n---\n' + HTML }, 'astro', 'src/layouts/Base.astro'],
  ['Vite', { 'package.json': pkg({ vite: '6', react: '19' }), 'index.html': HTML }, 'html', 'index.html'],
  ['plain HTML', { 'index.html': HTML }, 'html', 'index.html'],
  ['plain HTML in public/', { 'public/index.html': HTML }, 'html', 'public/index.html'],
])('%s', (_name, files, kind, target) => {
  const d = detect(project(files))
  expect(d).toMatchObject({ kind, target })
})

test('unsupported frameworks are named, with no target', () => {
  expect(detect(project({ 'package.json': pkg({ nuxt: '3' }) }))).toMatchObject({ framework: 'Nuxt', kind: 'manual' })
  expect(detect(project({ 'package.json': pkg({ gatsby: '5' }) }))).toMatchObject({ framework: 'Gatsby', kind: 'manual' })
  expect(detect(project({ 'package.json': pkg({ express: '5' }) }))).toMatchObject({ kind: 'unknown' })
})

test('meta-frameworks win over the vite they depend on', () => {
  expect(detect(project({ 'package.json': pkg({ vite: '6', '@sveltejs/kit': '2' }), 'src/app.html': HTML }))).toMatchObject({ framework: 'SvelteKit' })
})

test('Next.js: route-group root layouts are left to the user', () => {
  const d = detect(project({ 'package.json': pkg({ next: '15' }), 'app/(site)/layout.tsx': NEXT_LAYOUT, 'pages/api/x.ts': 'x' }))
  expect(d).toMatchObject({ kind: 'manual' })
})

test('Next.js hybrid: pages/ routes are reported as not covered', () => {
  const d = detect(project({ 'package.json': pkg({ next: '15' }), 'app/layout.tsx': NEXT_LAYOUT, 'pages/old.tsx': 'x', 'pages/api/y.ts': 'y' }))
  expect(d).toMatchObject({ kind: 'next-app', uncovered: ['pages/'] })
  expect(detect(project({ 'package.json': pkg({ next: '15' }), 'app/layout.tsx': NEXT_LAYOUT, 'pages/api/y.ts': 'y' }))).not.toHaveProperty('uncovered')
})

test('Astro: other files with their own <head> are reported as not covered', () => {
  const d = detect(project({ 'package.json': pkg({ astro: '5' }), 'src/layouts/Post.astro': HTML, 'src/pages/index.astro': HTML, 'src/pages/about.astro': '<Post/>' }))
  expect(d).toMatchObject({ kind: 'astro', target: 'src/layouts/Post.astro', uncovered: ['src/pages/index.astro'] })
})
