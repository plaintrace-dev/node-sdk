import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { detect } from './detect.js'
import { diff } from './diff.js'
import { applyEdit } from './edit.js'
import { type Script, snippet } from './snippet.js'

export interface Io {
  fetch: typeof fetch
  log: (line: string) => void
  /** True when stdin/stdout are a terminal and a question can be asked. */
  interactive: boolean
  ask?: (question: string) => Promise<boolean>
}

const USAGE = `Usage: plaintrace init --site <id> --endpoint <collector url> [options]

Adds the analytics script to your project's root layout or index.html.

Options:
  --site <id>        Site id from the dashboard (required)
  --endpoint <url>   Collector URL, e.g. https://collect.example.com (required)
  --dir <path>       Project folder (default: current folder)
  --latest           Use the unpinned latest script instead of a pinned version with SRI
  --dry-run          Show the change, write nothing
  --yes              Write without asking

Exit codes: 0 done or nothing to do, 1 needs your input, 2 failed.`

const SITE = /^[A-Za-z0-9_-]{1,64}$/
const SRI = /^sha(256|384|512)-[A-Za-z0-9+/]+={0,2}$/

async function resolveScript(io: Io, endpoint: string, site: string, latest: boolean): Promise<Script> {
  const fallback = { site, src: `${endpoint}/t.js` }
  if (latest) return fallback
  try {
    const res = await io.fetch(`${endpoint}/v1/sdk`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const info = (await res.json()) as { path?: unknown; integrity?: unknown }
    if (typeof info.path !== 'string' || !/^\/v\/[\w.-]+\/t\.js$/.test(info.path) || typeof info.integrity !== 'string' || !SRI.test(info.integrity))
      throw new Error('unexpected response')
    return { site, src: endpoint + info.path, integrity: info.integrity }
  } catch (e) {
    io.log(`! Could not read the pinned version from ${endpoint}/v1/sdk (${(e as Error).message}); using the latest script without SRI.`)
    return fallback
  }
}

export async function run(argv: string[], io: Io): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        site: { type: 'string' },
        endpoint: { type: 'string' },
        dir: { type: 'string' },
        latest: { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        yes: { type: 'boolean', short: 'y' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (e) {
    io.log(`${(e as Error).message}\n\n${USAGE}`)
    return 1
  }
  const { values: o, positionals } = parsed
  const cmd = positionals[0]
  if (o.help || cmd === 'help') return io.log(USAGE), 0
  if (cmd !== 'init') return io.log(cmd ? `Unknown command: ${cmd}\n\n${USAGE}` : USAGE), 1

  if (!o.site || !o.endpoint) return io.log(`Missing ${!o.site ? '--site' : '--endpoint'}.\n\n${USAGE}`), 1
  if (!SITE.test(o.site)) return io.log('--site must be the site id from the dashboard (letters, digits, - and _).'), 1
  let endpoint: string
  try {
    const u = new URL(o.endpoint)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error()
    if (u.search || u.hash || u.username || u.password) throw new Error()
    // new URL() leaves quotes and braces in the host; they would break out of the src attribute.
    if (!/^([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])$/.test(u.hostname) || !/^[A-Za-z0-9._~\/%-]*$/.test(u.pathname)) throw new Error()
    endpoint = u.href.replace(/\/+$/, '')
  } catch {
    return io.log('--endpoint must be an http(s) URL such as https://collect.example.com'), 1
  }

  try {
    const dir = resolve(o.dir ?? '.')
    const script = await resolveScript(io, endpoint, o.site, !!o.latest)
    const found = detect(dir)
    if (!('target' in found)) {
      io.log(
        found.kind === 'manual'
          ? `${found.framework} detected. It is not edited automatically; add this to ${found.hint}:`
          : 'No supported framework or index.html found. Add this to the <head> of every page:',
      )
      io.log(`\n${snippet('html', script)}\n`)
      return 1
    }

    const file = join(dir, found.target)
    let before = ''
    try {
      before = readFileSync(file, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT' || found.kind !== 'next-pages') throw e
    }
    const edit = applyEdit(found.kind, before, snippet(found.kind, script))
    io.log(`${found.framework} → ${found.target}`)
    if (!edit.ok) {
      if (edit.reason === 'already_installed') return io.log('The tracker is already installed (data-site found); nothing to do.'), 0
      io.log(
        `${edit.reason === 'no_anchor' ? 'Could not find' : 'Found more than one'} insertion point in ${found.target}; not editing. Add this yourself:`,
      )
      io.log(`\n${snippet(found.kind, script)}\n`)
      return 1
    }

    io.log(`\n${diff(before, edit.content)}\n`)
    if (o['dry-run']) return io.log('Dry run: nothing written.'), 0
    if (!o.yes) {
      if (!io.interactive || !io.ask) return io.log('Not a terminal: rerun with --yes to write the change.'), 1
      if (!(await io.ask(`Write ${found.target}?`))) return io.log('Nothing written.'), 1
    }
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, edit.content)
    io.log(`✓ Updated ${found.target}. Deploy, open your site, and the dashboard shows the first visit within seconds.`)
    if (found.uncovered) io.log(`! These are not covered by ${found.target} and need the tag too: ${found.uncovered.join(', ')}`)
    return 0
  } catch (e) {
    io.log(`Error: ${(e as Error).message}`)
    return 2
  }
}
