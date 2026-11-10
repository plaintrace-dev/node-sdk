import type { Kind } from './detect.js'

export type EditResult = { ok: true; content: string } | { ok: false; reason: 'already_installed' | 'no_anchor' | 'ambiguous_anchor' }

const ANCHOR: Record<Kind, RegExp> = {
  html: /<\/head>/gi,
  astro: /<\/head>/gi,
  jsx: /<\/head>/g,
  'next-pages': /<\/Head>/g,
  'next-app': /<\/body>/g,
}

const DOCUMENT = `import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html>
      <Head>
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
`

/** Inserts tag before the file's single anchor, indented one level deeper than the anchor's line. */
export function applyEdit(kind: Kind, content: string, tag: string): EditResult {
  // Ours = a tag (<script>, or next/script under any name) served as .../t.js with data-site (other vendors use data-site too).
  const tags = content.match(/<[A-Za-z][\w.]*\b[^>]*>/g) ?? []
  if (tags.some((t) => /data-site=/.test(t) && /\bsrc=["'][^"']*\/t\.js["']/.test(t))) return { ok: false, reason: 'already_installed' }
  if (kind === 'next-pages' && content.trim() === '') content = DOCUMENT
  // create-next-app writes a self-closing <Head />.
  if (kind === 'next-pages' && !content.includes('</Head>') && (content.match(/<Head\s*\/>/g) ?? []).length === 1)
    content = content.replace(/<Head\s*\/>/, '<Head></Head>')
  const hits = [...content.matchAll(ANCHOR[kind])]
  if (hits.length === 0) return { ok: false, reason: 'no_anchor' }
  if (hits.length > 1) return { ok: false, reason: 'ambiguous_anchor' }
  // The file's own conventions: its line ending, and tabs when it indents with tabs.
  const eol = /\r\n/.test(content) && !/(^|[^\r])\n/.test(content) ? '\r\n' : '\n'
  // next/script already imported, maybe under another name: use that name, add no import.
  const imported = kind === 'next-app' ? defaultImportOf(content) : undefined
  if (imported) tag = tag.replace(/^<Script\b/, `<${imported}`)
  const at = hits[0]!.index
  const lineStart = content.lastIndexOf('\n', at - 1) + 1
  const indent = content.slice(lineStart, at)
  let out: string
  if (/^[ \t]*$/.test(indent)) {
    const unit = indent.includes('\t') ? '\t' : '  '
    const lines = tag.split('\n').map((l) => `${indent}${unit}${l}${eol}`).join('')
    out = content.slice(0, lineStart) + lines + content.slice(lineStart)
  } else {
    out = content.slice(0, at) + tag.replace(/\n/g, '') + content.slice(at)
  }
  if (kind === 'next-app' && !imported) {
    // A byte order mark stays first; then a leading 'use client' / 'use strict' directive (and comments before it).
    const bom = out.startsWith('\uFEFF') ? '\uFEFF' : ''
    const rest = out.slice(bom.length)
    const directive = rest.match(/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*(['"])use [a-z]+\1;?[^\n]*\n/)
    const head = directive ? directive[0] : ''
    out = bom + head + `import Script from 'next/script'${eol}` + rest.slice(head.length)
  }
  return { ok: true, content: out }
}

/** The local name of next/script's default export in this file, if it is imported (comments ignored). */
function defaultImportOf(content: string): string | undefined {
  const code = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const clause = code.match(/import\s+([^'";]+?)\s+from\s+['"]next\/script['"]/)?.[1]
  if (!clause) return undefined
  const id = '[A-Za-z_$][\\w$]*'
  const plain = clause.match(new RegExp(`^(${id})\\s*(,|$)`))?.[1] // import Script / import Script, { … }
  const aliased = clause.match(new RegExp(`\\bdefault\\s+as\\s+(${id})`))?.[1] // import { default as S }
  const namespace = clause.match(new RegExp(`\\*\\s*as\\s+(${id})`))?.[1] // import * as NS
  return plain ?? aliased ?? (namespace ? `${namespace}.default` : undefined)
}
