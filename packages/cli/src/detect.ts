import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

export type Kind = 'next-app' | 'next-pages' | 'jsx' | 'html' | 'astro'
export type Detection =
  | { framework: string; kind: Kind; target: string; uncovered?: string[] }
  | { framework: string; kind: 'manual' | 'unknown'; hint?: string }

const JS = ['tsx', 'jsx', 'ts', 'js']

function deps(dir: string): Record<string, string> | null {
  try {
    const p = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    return { ...p.dependencies, ...p.devDependencies }
  } catch {
    return null
  }
}

/** First existing path among the candidates, relative to dir. */
function first(dir: string, candidates: string[]): string | undefined {
  return candidates.find((c) => existsSync(join(dir, c)))
}

const withExt = (base: string) => JS.map((e) => `${base}.${e}`)

function walk(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith(ext))
    .sort()
    .map((f) => join(dir, f))
}

function next(dir: string): Detection {
  const pagesDir = first(dir, ['pages', 'src/pages'])
  const app = first(dir, [...withExt('app/layout'), ...withExt('src/app/layout')])
  if (app) {
    // Pages Router routes (other than API routes) don't render the App Router layout.
    const routes = pagesDir && readdirSync(join(dir, pagesDir), { recursive: true, encoding: 'utf8' }).some((f) => /\.[jt]sx?$/.test(f) && !/^api[\\/]/.test(f))
    return { framework: 'Next.js (App Router)', kind: 'next-app', target: app, ...(routes ? { uncovered: [`${pagesDir}/`] } : {}) }
  }
  const appDir = first(dir, ['app', 'src/app'])
  if (appDir) return { framework: 'Next.js (App Router)', kind: 'manual', hint: `each root layout under ${appDir}/ (inside the <body> of every (group)/layout)` }
  if (!pagesDir) return { framework: 'Next.js', kind: 'manual', hint: 'app/layout.tsx' }
  const doc = first(dir, withExt(`${pagesDir}/_document`))
  if (doc) return { framework: 'Next.js (Pages Router)', kind: 'next-pages', target: doc }
  const ts = readdirSync(join(dir, pagesDir), { recursive: true, encoding: 'utf8' }).some((f) => /\.tsx?$/.test(f))
  return { framework: 'Next.js (Pages Router)', kind: 'next-pages', target: `${pagesDir}/_document.${ts ? 'tsx' : 'jsx'}` }
}

function astro(dir: string): Detection {
  const hasHead = (f: string) => /<\/head>/i.test(readFileSync(f, 'utf8'))
  const layout = walk(join(dir, 'src/layouts'), '.astro').find(hasHead)
  const target = layout ? relative(dir, layout) : first(dir, ['src/pages/index.astro'])
  if (!target) return { framework: 'Astro', kind: 'manual', hint: 'the <head> of your base layout' }
  // Any other file with its own <head> renders pages this edit does not reach.
  const uncovered = walk(join(dir, 'src'), '.astro').filter(hasHead).map((f) => relative(dir, f)).filter((f) => f !== target)
  return { framework: 'Astro', kind: 'astro', target, ...(uncovered.length ? { uncovered } : {}) }
}

const MANUAL: [string, string, string][] = [
  ['nuxt', 'Nuxt', 'app.head in nuxt.config.ts'],
  ['gatsby', 'Gatsby', 'onRenderBody in gatsby-ssr.js'],
  ['@angular/core', 'Angular', 'src/index.html'],
]

/** Works out where the tracker tag belongs. Meta-frameworks are checked before the bundler they use. */
export function detect(dir: string): Detection {
  const d = deps(dir) ?? {}
  if (d.next) return next(dir)
  for (const [dep, framework, hint] of MANUAL) if (d[dep]) return { framework, kind: 'manual', hint }
  if (d['@sveltejs/kit']) {
    const t = first(dir, ['src/app.html'])
    return t ? { framework: 'SvelteKit', kind: 'html', target: t } : { framework: 'SvelteKit', kind: 'manual', hint: 'src/app.html' }
  }
  if (d.astro) return astro(dir)
  if (d['@react-router/dev'] || Object.keys(d).some((k) => k.startsWith('@remix-run/'))) {
    const t = first(dir, withExt('app/root'))
    const framework = d['@react-router/dev'] ? 'React Router' : 'Remix'
    return t ? { framework, kind: 'jsx', target: t } : { framework, kind: 'manual', hint: 'app/root.tsx' }
  }
  const html = first(dir, ['index.html', 'public/index.html'])
  if (html) return { framework: d.vite ? 'Vite' : 'HTML', kind: 'html', target: html }
  return { framework: 'unknown', kind: 'unknown' }
}
