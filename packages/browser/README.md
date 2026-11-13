# @plaintrace/browser

The browser tracker for [Plaintrace](https://plaintrace.dev), cookieless web analytics that tells you how far to
trust every number. No cookies, no device identifiers: the collector counts visitors with a daily, salted hash
it cannot reverse, and the browser keeps only two things, the visitor's consent answer and the site owner's own
opt-out. About 8 KB gzip.

Docs: [plaintrace.dev/docs](https://plaintrace.dev/docs) · Your site id is in the dashboard under Settings → Install.

## Script tag

The dashboard gives you the tag with the current version and its integrity hash (also at
`https://collect.plaintrace.dev/v1/sdk`), or run `npx @plaintrace/cli init`:

```html
<script>if(!window.px){var p=window.px=function(){p.q.push(arguments)};p.q=[];p.s=1}</script>
<script async src="https://collect.plaintrace.dev/v/<version>/t.js"
        integrity="sha384-…" crossorigin="anonymous"
        data-site="<site id>"></script>
```

`https://collect.plaintrace.dev/t.js` always serves the latest release (5-minute cache) for those who prefer
automatic updates over a pinned hash. A published version never changes, so its hash keeps matching. The one-line stub lets you call `px(...)` before
the script arrives; calls are applied in order once it does.

```js
px('track', 'signup', { plan: 'pro' })   // custom event
px('conversion', 'trial_started')
px('identify', user.id)                  // an opaque id; only its hash is kept
px('consent', 'granted')                 // or 'denied', 'unknown'
px('pageUrl', (href) => href.replace(/\/orders\/\d+/, '/orders/:id'))  // before the first page view
const visit = px('visitId')              // for checkout metadata (revenue attribution)
```

## npm

```ts
import { init, track } from '@plaintrace/browser'

init({ site: '<site id>', endpoint: 'https://collect.plaintrace.dev' })   // undefined during SSR
track('signup', { plan: 'pro' })
```

`init()` is safe to call more than once and returns the tracker the script tag started, if any.

## Options

| `data-*` attribute     | `init()` field   | Default            | Effect |
|------------------------|------------------|--------------------|--------|
| `data-site`            | `site`           | required           | The site id (public). |
| `data-endpoint`        | `endpoint`       | the script's origin | The collector, or your first-party proxy path (e.g. `/_i`). |
| `data-require-consent` | `requireConsent` | `false`            | Nothing is measured until `consent('granted')`. |
| `data-respect-gpc`     | `respectGpc`     | `false`            | Browsers sending Global Privacy Control are left out. |
| `data-respect-dnt`     | `respectDnt`     | `false`            | Browsers sending Do Not Track are left out. |
| `data-storage="none"`  | `storage: 'none'`| `auto`             | Even the consent answer and opt-out stay in memory. |
| `data-exclude-paths`   | `excludePaths`   | none               | Comma-separated; exact or a trailing `*`. Nothing is sent there. |
| `data-debug`           | `debug`          | `false`            | Logs deliveries; lets automated browsers send events. |
|                        | `pageUrl`        | none               | Rewrites each address before it is recorded. |

## What is sent

- **Page views** with how the page was reached: `load` (a full load), `soft` (an SPA route
  change), `restore` (back/forward cache) or `prerender` (a prerendered page being shown).
  Reports compare only full loads with what your server saw, to measure what ad blockers lose.
- **Engagement** when the visitor leaves a page: time visible, time interacting, deepest scroll.
- **Your events**: names `[A-Za-z0-9][A-Za-z0-9_.:-]`, up to 64 characters; up to 32
  properties of string (256 chars), number or boolean (nulls are dropped).
- **Clicks, only when the site's owner turns heatmaps on** (Settings → Collection): the clicked
  element as a stable selector, the position inside it (0–1000), the screen size class, and
  whether it was a rage click (three in one spot within 700 ms) or a dead click (nothing changed
  for a second). Never the text clicked on (buttons and links are told apart by a hash of their
  text), never a field's value. Password and card fields, and anything inside an element with
  `data-pt-ignore`, are never recorded. At most 50 clicks per page view; no visit or visitor id.

Before anything leaves the browser, the fragment and credentials are removed from addresses,
sensitive parameters (`token`, `email`, `password`, … and your site's own list) are dropped,
emails and long digit runs become `[redacted]`, and ids in paths (`/users/<uuid>`, long random strings)
become `:id`; long readable page names such as `/resize-for-instagram-post` are kept. The collector applies the same rules again for any other sender.

Opening a page from the dashboard's Heatmaps tab adds `#pt-heatmap=…` to its address: the
tracker then measures nothing, removes the token from the address, and loads the overlay
(`/v/<version>/overlay.js`, about 4 KB gzip) that draws the clicks on the page.

Add `#px-ignore` to any address on your site to stop counting your own browser
(`#px-unignore` to undo). Automated browsers (Playwright, Puppeteer, Selenium) are not
counted unless `debug` is on.

Failed sends are retried with backoff and the collector's `Retry-After`; what is finally
lost is counted and reported, so reports can say how complete they are.

## Licence

MIT © VALUNLABS LLC. Questions and issues: [hello@plaintrace.dev](mailto:hello@plaintrace.dev) or
[GitHub](https://github.com/plaintrace-dev/node-sdk/issues).
