# @plaintrace/cli

Adds the [Plaintrace](https://plaintrace.dev) analytics script to a web project in one command. Your site id is in
the dashboard under Settings → Install.

```bash
npx @plaintrace/cli init --site <site id> --endpoint https://collect.plaintrace.dev
```

It finds your framework, shows the change as a diff, and asks before writing. By default it pins the
current script version with Subresource Integrity (read from `<endpoint>/v1/sdk`); `--latest` uses the
unpinned `/t.js` instead.

| Framework | File it edits |
|---|---|
| Next.js App Router | `app/layout.*` or `src/app/layout.*` (adds `next/script`) |
| Next.js Pages Router | `pages/_document.*` (created if missing) |
| React Router / Remix | `app/root.*` |
| SvelteKit | `src/app.html` |
| Astro | first `src/layouts/**/*.astro` with a `</head>`, else `src/pages/index.astro` |
| Vite, plain HTML | `index.html` or `public/index.html` |

Nuxt, Gatsby, Angular and anything else get the snippet printed with where to put it; nothing is
edited. It also leaves the file alone when the tracker is already there (`data-site`), or when the
insertion point (`</head>`, `</Head>` or `</body>`) is missing or appears more than once.

Options: `--dir <path>`, `--dry-run`, `--yes` (required when not run in a terminal), `--latest`.
Exit codes: 0 done or nothing to do, 1 needs your input, 2 failed.

JSX targets get only the script tag, without the inline `px()` queue stub; call `px()` after the
script loads, or add the stub yourself with `dangerouslySetInnerHTML`.

## Licence

MIT © VALUNLABS LLC. Docs: [plaintrace.dev/docs](https://plaintrace.dev/docs). Issues:
[GitHub](https://github.com/plaintrace-dev/node-sdk/issues).
