/** How a page view's page was reached. Only 'load' is a request the site's server also saw:
    'soft' is an SPA route change, 'restore' a page from the back/forward or HTTP cache,
    'prerender' a page prerendered or prefetched speculatively. */
export type NavKind = 'load' | 'soft' | 'restore' | 'prerender'

/* A router often sets the new page's title just after its address: a soft page view waits
   for the title to change, at most this long, unless settle() sends it sooner. */
const TITLE_WAIT_MS = 2_000

type Win = Window & { navigation?: EventTarget }

/* The first page is a 'load' only when the site's server answered it. A back/forward page
   from the browser cache, or one delivered from a speculation prefetch (which the server
   SDK does not count), is not. */
function firstKind(win: Win): NavKind {
  const entry = win.performance?.getEntriesByType?.('navigation')[0] as (PerformanceNavigationTiming & { deliveryType?: string }) | undefined
  if (!entry) return 'load'
  if (entry.deliveryType === 'navigational-prefetch') return 'prerender'
  if (entry.deliveryType === 'cache') return 'restore'
  if (entry.type === 'back_forward' && entry.transferSize === 0) return 'restore'
  return 'load'
}

/** Reports every page the visitor sees. With the Navigation API, history is left untouched,
    so one route change is never counted twice. */
export function watchNavigation(win: Win, onPage: (kind: NavKind) => void): { stop(): void; settle(): void } {
  const doc = win.document
  let lastPath = win.location.pathname
  let pending: (() => void) | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let observer: MutationObserver | undefined
  const cleanups: (() => void)[] = []
  const on = (target: EventTarget, type: string, fn: EventListener) => {
    target.addEventListener(type, fn)
    cleanups.push(() => target.removeEventListener(type, fn))
  }

  const settle = () => pending?.()

  const routeChanged = () => {
    const path = win.location.pathname
    if (path === lastPath) return // a query or hash change is the same page
    lastPath = path
    settle()
    const title = doc.title
    const send = () => {
      if (pending !== send) return
      pending = null
      clearTimeout(timer)
      observer?.disconnect()
      onPage('soft')
    }
    pending = send
    if (typeof MutationObserver === 'function') {
      observer = new MutationObserver(() => doc.title !== title && send())
      observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true })
    }
    timer = setTimeout(send, TITLE_WAIT_MS)
  }

  if (win.navigation && typeof win.navigation.addEventListener === 'function') {
    on(win.navigation, 'navigatesuccess', routeChanged)
  } else {
    const history = win.history
    const original = { push: history.pushState, replace: history.replaceState }
    history.pushState = function (...args: Parameters<History['pushState']>) {
      original.push.apply(this, args)
      routeChanged()
    }
    history.replaceState = function (...args: Parameters<History['replaceState']>) {
      original.replace.apply(this, args)
      routeChanged()
    }
    cleanups.push(() => {
      history.pushState = original.push
      history.replaceState = original.replace
    })
    on(win, 'popstate', routeChanged)
  }

  on(win, 'pageshow', (e) => {
    if (!(e as PageTransitionEvent).persisted) return
    settle()
    lastPath = win.location.pathname
    onPage('restore')
  })

  if ((doc as Document & { prerendering?: boolean }).prerendering) {
    const shown = () => {
      doc.removeEventListener('prerenderingchange', shown)
      onPage('prerender')
    }
    doc.addEventListener('prerenderingchange', shown)
    cleanups.push(() => doc.removeEventListener('prerenderingchange', shown))
  } else {
    onPage(firstKind(win))
  }

  return {
    settle,
    stop() {
      pending = null
      clearTimeout(timer)
      observer?.disconnect()
      for (const c of cleanups.splice(0)) c()
    },
  }
}
