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
  if (url.pathname === '/v1/config') return send(200, '{"allowed_domains":[],"redact_query_keys":[]}')
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
