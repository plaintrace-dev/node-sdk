# @plaintrace/server

Runs on your server, next to your app: serves the tracker from your own domain (past ad
blockers), records crawler reads that no browser script can see, counts human page loads so
reports can show **measured** loss, and sends events from your backend. Web standards only
(`Request`, `Response`, `fetch`, `crypto.subtle`): Node 24+, Bun, Deno, Cloudflare Workers.

```ts
import { createClient } from '@plaintrace/server'

const analytics = createClient({ key: process.env.ANALYTICS_KEY!, endpoint: process.env.ANALYTICS_ENDPOINT! })

// In your middleware, before the app:
const res = await analytics.handle(request, { waitUntil: ctx.waitUntil })
if (res) return res

// From your backend, for the visitor behind `request`:
await analytics.track('purchase', { request, properties: { plan: 'pro' }, userId: user.id })
```

- The key (`sk_live_…`, ingest scope) is secret: never ship it to a browser.
- Every call to the collector is signed (HMAC over method, path, body and time).
- Only the user agent, language, origin, referer, `Sec-Fetch-*`, client hints and `Sec-GPC`
  reach the collector; cookies, your own `Authorization` and `Host` never do.
- **The visitor's address.** A visitor can send any header themselves, so by default only
  Cloudflare Workers' `CF-Connecting-IP` is trusted. Elsewhere set `ipHeader` to the one
  header your own edge overwrites (`x-vercel-forwarded-for` on Vercel, `fly-client-ip` on
  Fly, `x-real-ip` behind nginx; `x-forwarded-for` is read from its right end), or pass `ip`.
- `handle()` counts a page load before your app answers, so redirects and errors count too.
  For exact numbers call `hits(request, { status })` after the response instead and set
  `measureLoss: false` on `handle()`'s client.
- `measureLoss: false` turns off page-load counting (one extra collector call per page load).
