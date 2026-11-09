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
  // Ours = a script tag served as .../t.js that carries data-site (other vendors use data-site too).
  const tags = content.match(/<script\b[^>]*>/gi) ?? []
  if (tags.some((t) => /data-site=/.test(t) && /\bsrc=["'][^"']*\/t\.js["']/.test(t))) return { ok: false, reason: 'already_installed' }
  if (kind === 'next-pages' && content.trim() === '') content = DOCUMENT
  // create-next-app writes a self-closing <Head />.
  if (kind === 'next-pages' && !content.includes('</Head>') && (content.match(/<Head\s*\/>/g) ?? []).length === 1)
    content = content.replace(/<Head\s*\/>/, '<Head></Head>')
  const hits = [...content.matchAll(ANCHOR[kind])]
  if (hits.length === 0) return { ok: false, reason: 'no_anchor' }
  if (hits.length > 1) return { ok: false, reason: 'ambiguous_anchor' }
  const at = hits[0]!.index
  const lineStart = content.lastIndexOf('\n', at - 1) + 1
  const indent = content.slice(lineStart, at)
  let out: string
  if (/^[ \t]*$/.test(indent)) {
    const lines = tag.split('\n').map((l) => `${indent}  ${l}\n`).join('')
    out = content.slice(0, lineStart) + lines + content.slice(lineStart)
  } else {
    out = content.slice(0, at) + tag.replace(/\n/g, '') + content.slice(at)
  }
  if (kind === 'next-app' && !/from\s+['"]next\/script['"]/.test(out)) {
    // Keep a leading 'use client' / 'use strict' directive (and comments before it) first.
    const directive = out.match(/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*(['"])use [a-z]+\1;?[^\n]*\n/)
    const head = directive ? directive[0] : ''
    // shortcut: assumes the default import is named Script; a renamed import would need its name used in the tag.
    out = head + "import Script from 'next/script'\n" + out.slice(head.length)
  }
  return { ok: true, content: out }
}
