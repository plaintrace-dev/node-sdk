# Plaintrace SDK

Open-source clients for [Plaintrace](https://plaintrace.dev): cookieless web analytics that tells
you how far to trust every number.

| Package | What it does |
|---|---|
| [`@plaintrace/browser`](packages/browser) | The tracker (`t.js`, ≈ 5.6 KB gzip): page views, events, conversions, engagement. No cookies, no local storage. |
| [`@plaintrace/server`](packages/server) | First-party proxy, crawler and AI-bot reads, measured ad-blocker loss, server-side events. |
| [`@plaintrace/cli`](packages/cli) | `npx @plaintrace/cli init` adds the script to Next.js, Remix/React Router, SvelteKit, Astro, Vite or plain HTML. |

## Develop

Node v24.22.0 (`nvm use`).

```bash
npm install
npm test            # unit tests for all packages
npm run build
npx playwright install chromium && npm run e2e -w packages/browser   # tracker in a real browser
```

The collector, API and dashboard are a hosted service and are not in this repository.

MIT licensed.
