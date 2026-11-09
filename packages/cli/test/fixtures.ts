import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** A throwaway project: { 'package.json': {...} | 'text', 'app/layout.tsx': '...' } */
export function project(files: Record<string, string | object>): string {
  const dir = mkdtempSync(join(tmpdir(), 'cli-'))
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), typeof body === 'string' ? body : JSON.stringify(body))
  }
  return dir
}

export const pkg = (deps: Record<string, string>) => ({ name: 'x', dependencies: deps })

export const HTML = '<!doctype html>\n<html>\n  <head>\n    <title>x</title>\n  </head>\n  <body></body>\n</html>\n'
export const NEXT_LAYOUT = `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
`
export const ROOT_TSX = `import { Links, Meta, Outlet, Scripts } from 'react-router'

export default function App() {
  return (
    <html>
      <head>
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  )
}
`
