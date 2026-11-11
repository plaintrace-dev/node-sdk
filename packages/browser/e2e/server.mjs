// The pages under test and a fake collector on one origin: it records every batch it is sent.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, normalize } from 'node:path'

const port = Number(process.argv[2] ?? 4173)
const root = new URL('.', import.meta.url).pathname
let batches = []

const read = (req) => new Promise((resolve) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => resolve(body))
})

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`)
  const send = (status, body, type = 'application/json') => {
    // Pages sent with no-store are never kept in the back/forward cache: HTML is revalidated instead.
    res.writeHead(status, { 'content-type': type, 'cache-control': type.startsWith('text/html') ? 'no-cache' : 'no-store' })
    res.end(body)
  }
  if (url.pathname === '/t.js') return send(200, await readFile(join(root, '../dist/t.js')), 'text/javascript')
  if (url.pathname === '/v1/config') return send(200, JSON.stringify({ allowed_domains: [], redact_query_keys: [], heatmaps: url.searchParams.get('site') === 'heat', app_origin: `http://localhost:${port}` }))
  if (/^\/(v\/[^/]+\/)?overlay\.js$/.test(url.pathname)) return send(200, await readFile(join(root, '../dist/overlay.js')), 'text/javascript')
  // The dashboard API's overlay endpoint: '#buy' is on the page, '#gone' is not.
  if (url.pathname === '/v1/heatmaps/data') {
    // As the real API: the token comes in a header, never in the address.
    if (url.searchParams.has('token')) return send(401, '{}')
    const token = req.headers['x-heatmap-token'] ?? ''
    if (token.startsWith('00000000')) return send(401, '{}') // an expired link
    if (token.startsWith('eeeeeeee')) // hostile data: must never become HTML on the page
      return send(200, JSON.stringify({ views: '<img src=x onerror="window.__xss=1">', small: false, cell_size: 50,
        clicks: [{ selector: '<img src=x onerror="window.__xss=2">', cx: 1, cy: 1, count: 3 }], elements: [], scroll_reach: [] }))
    return send(200, JSON.stringify({
      views: 40, total: 8, truncated: false, small: false, cell_size: 50,
      clicks: [{ selector: '#buy', cx: 10, cy: 10, count: 6 }, { selector: '#gone', cx: 0, cy: 0, count: 2 }],
      elements: [{ selector: '#buy', clicks: 6, rage: 2, dead: 0 }, { selector: '#gone', clicks: 2, rage: 0, dead: 0 }],
      scroll_reach: [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1],
    }))
  }
  if (url.pathname === '/v1/events' && req.method === 'POST') {
    batches.push(JSON.parse(await read(req)))
    return send(202, '{"visit_id":"v.sig","accepted":1,"rejected":[]}')
  }
  if (url.pathname === '/__events') {
    if (req.method === 'DELETE') batches = []
    return send(200, JSON.stringify(batches.flatMap((b) => b.events)))
  }
  if (url.pathname.startsWith('/fixtures/')) {
    const file = normalize(join(root, url.pathname))
    if (!file.startsWith(join(root, 'fixtures'))) return send(403, '')
    try {
      return send(200, await readFile(file), 'text/html; charset=utf-8')
    } catch {
      return send(404, '')
    }
  }
  send(404, '')
}).listen(port)
