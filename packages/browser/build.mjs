// Builds dist/t.js (the script tag, IIFE) and dist/index.js (ESM) and refuses a t.js over
// the 10 KB gzip budget. `--copy` also writes the collector's embedded copy and manifest.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { build } from 'esbuild'

const BUDGET_GZIP = 10_240
const OVERLAY_BUDGET_GZIP = 20_480
const pkg = JSON.parse(readFileSync(new URL('package.json', import.meta.url)))
const define = { __VERSION__: JSON.stringify(pkg.version) }
const common = { bundle: true, minify: true, target: 'es2020', define, legalComments: 'none', logLevel: 'warning' }

await build({ ...common, entryPoints: ['src/boot.ts'], outfile: 'dist/t.js', format: 'iife' })
await build({ ...common, entryPoints: ['src/index.ts'], outfile: 'dist/index.js', format: 'esm', minify: false })
// The heatmap overlay: loaded only when the owner opens a page from the dashboard.
await build({ ...common, entryPoints: ['src/overlay/index.ts'], outfile: 'dist/overlay.js', format: 'iife' })
execFileSync(process.execPath, [new URL('node_modules/typescript/bin/tsc', new URL('../../', import.meta.url)).pathname, '-p', 'tsconfig.json', '--emitDeclarationOnly'], { stdio: 'inherit' })

const script = readFileSync('dist/t.js')
const gzip = gzipSync(script).length
console.log(`t.js ${script.length} B, ${gzip} B gzip (budget ${BUDGET_GZIP})`)
if (gzip > BUDGET_GZIP) {
  console.error('t.js is over its gzip budget')
  process.exit(1)
}
const overlay = readFileSync('dist/overlay.js')
const overlayGzip = gzipSync(overlay).length
console.log(`overlay.js ${overlay.length} B, ${overlayGzip} B gzip (budget ${OVERLAY_BUDGET_GZIP})`)
if (overlayGzip > OVERLAY_BUDGET_GZIP) {
  console.error('overlay.js is over its gzip budget')
  process.exit(1)
}

if (process.argv.includes('--copy')) {
  const assets = new URL('../../internal/scripts/assets/', import.meta.url)
  mkdirSync(assets, { recursive: true })
  writeFileSync(new URL('t.js', assets), script)
  writeFileSync(new URL('overlay.js', assets), overlay)
  // Releases stay: a pinned /v/<version>/t.js must keep working after the next one.
  const release = new URL(`v/${pkg.version}/`, assets)
  mkdirSync(release, { recursive: true })
  writeFileSync(new URL('t.js', release), script)
  writeFileSync(new URL('overlay.js', release), overlay)
  const integrity = `sha384-${createHash('sha384').update(script).digest('base64')}`
  writeFileSync(new URL('manifest.json', assets), JSON.stringify({ version: pkg.version, integrity }, null, 2) + '\n')
  console.log(`copied to internal/scripts/assets (${integrity})`)
}
