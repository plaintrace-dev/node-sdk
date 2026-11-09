import type { Kind } from './detect.js'

export interface Script {
  site: string
  src: string
  /** Absent for the unpinned latest script. */
  integrity?: string
}

/** Same stub as the browser SDK: queues px() calls made before the script loads. */
export const STUB = 'if(!window.px){var p=window.px=function(){p.q.push(arguments)};p.q=[];p.s=1}'

function attrs(s: Script, crossorigin: string): string {
  const sri = s.integrity ? ` integrity="${s.integrity}" ${crossorigin}="anonymous"` : ''
  return `src="${s.src}"${sri} data-site="${s.site}"`
}

/** The tag to insert, one element per line. Inputs are validated by the caller (no quotes, no markup). */
export function snippet(kind: Kind, s: Script): string {
  switch (kind) {
    case 'html':
      return `<script>${STUB}</script>\n<script async ${attrs(s, 'crossorigin')}></script>`
    case 'astro':
      return `<script is:inline>${STUB}</script>\n<script is:inline async ${attrs(s, 'crossorigin')}></script>`
    case 'jsx':
    case 'next-pages':
      return `<script async ${attrs(s, 'crossOrigin')} />`
    case 'next-app':
      return `<Script ${attrs(s, 'crossOrigin')} strategy="afterInteractive" />`
  }
}
