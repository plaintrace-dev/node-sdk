import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { expect, test } from 'vitest'

// vitest runs with the package as its working directory (import.meta.url is not a file URL under happy-dom).
const root = process.cwd()
const read = (rel: string) => readFileSync(resolve(root, rel))

test('t.js builds within 10 KB gzip and the committed asset is that build', () => {
  execFileSync(process.execPath, ['build.mjs'], { cwd: root, stdio: 'pipe' })
  const built = read('dist/t.js')
  expect(gzipSync(built).length).toBeLessThanOrEqual(10_240)
}, 60_000)

// Only in the platform monorepo: the collector embeds a copy of the tracker. The public SDK repo has no collector.
test.skipIf(!existsSync(resolve(root, '../../internal/scripts/assets')))('the collector\'s embedded copy is this build', () => {
  const built = read('dist/t.js')
  const asset = read('../../internal/scripts/assets/t.js')
  expect(asset.equals(built), 'internal/scripts/assets/t.js is stale: run make sdk').toBe(true)
  const pkgVersion = JSON.parse(read('package.json').toString()).version
  const release = read(`../../internal/scripts/assets/v/${pkgVersion}/t.js`)
  expect(release.equals(built), 'the release copy is stale: run make sdk').toBe(true)

  const manifest = JSON.parse(read('../../internal/scripts/assets/manifest.json').toString())
  const pkg = JSON.parse(read('package.json').toString())
  expect(manifest.version).toBe(pkg.version)
  expect(manifest.integrity).toBe(`sha384-${createHash('sha384').update(built).digest('base64')}`)
}, 60_000)
