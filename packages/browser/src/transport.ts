/** One event as the collector's /v1/events takes it. */
export interface OutEvent {
  readonly event_id: string
  readonly type: 'page_view' | 'custom_event' | 'conversion' | 'identify' | 'engagement'
  readonly occurred_at: string
  readonly page?: { readonly url: string; readonly title?: string }
  readonly referrer?: string
  readonly name?: string
  readonly props?: Record<string, string | number | boolean | null>
  readonly external_user_id?: string
  readonly navigation?: 'load' | 'soft' | 'restore' | 'prerender'
  readonly engagement?: { readonly active_ms: number; readonly visible_ms: number; readonly scroll_depth: number }
}

export interface TransportOptions {
  readonly endpoint: string
  readonly site: string
  readonly sdk: { readonly name: 'web' | 'web-npm'; readonly version: string }
  readonly fetchImpl: typeof fetch
  readonly beaconImpl?: (url: string, body: string) => boolean
  readonly now: () => number
  readonly random: () => number
  readonly schedule: (fn: () => void, ms: number) => () => void
  /** False once nothing may be measured; the transport then sends and keeps nothing. */
  readonly maySend: () => boolean
  /** True while the site's settings are on their way: events wait (an exit still sends them). */
  readonly held: () => boolean
  readonly onVisit: (visitId: string) => void
  readonly onDelivery?: (events: readonly OutEvent[], problem: string | null) => void
}

const BATCH_DELAY_MS = 1_000
const MAX_EVENTS = 100
const MAX_BYTES = 60_000
const MAX_QUEUE = 200
const BACKOFF_BASE_MS = 2_000
const BACKOFF_MAX_MS = 5 * 60_000
const MAX_ATTEMPTS = 8

const encoder = new TextEncoder()
const size = (v: unknown) => encoder.encode(JSON.stringify(v)).length

function chunk(events: OutEvent[], envelope: number): OutEvent[][] {
  const out: OutEvent[][] = []
  let cur: OutEvent[] = []
  let bytes = envelope
  for (const e of events) {
    const n = size(e) + 1
    if (cur.length > 0 && (cur.length >= MAX_EVENTS || bytes + n > MAX_BYTES)) {
      out.push(cur)
      cur = []
      bytes = envelope
    }
    cur.push(e)
    bytes += n
  }
  if (cur.length > 0) out.push(cur)
  return out
}

function retryAfterMs(h: string | null, now: number): number | null {
  if (!h) return null
  const s = Number(h)
  const ms = Number.isFinite(s) ? s * 1000 : Date.parse(h) - now
  return ms >= 0 ? ms : null
}

export function createTransport(o: TransportOptions) {
  const url = `${o.endpoint.replace(/\/+$/, '')}/v1/events`
  let buffer: OutEvent[] = []
  let queue: OutEvent[] = []
  let stats = { dropped: 0, retried: 0, queued: 0 }
  let attempts = 0
  let backoffUntil = 0
  let generation = 0
  let cancelTimer: (() => void) | null = null
  const inflight = new Set<AbortController>()

  const requeue = (events: readonly OutEvent[]) => {
    queue = queue.concat(events)
    if (queue.length > MAX_QUEUE) {
      stats.dropped += queue.length - MAX_QUEUE
      queue = queue.slice(queue.length - MAX_QUEUE)
    }
  }

  const later = (fn: () => void, ms: number) => {
    cancelTimer?.()
    const gen = generation
    cancelTimer = o.schedule(() => {
      cancelTimer = null
      if (gen === generation) fn()
    }, ms)
  }

  const backOff = (serverMs: number | null) => {
    attempts += 1
    if (attempts >= MAX_ATTEMPTS) {
      // The collector stays unreachable: let go, but say how much was lost.
      stats.dropped += queue.length
      queue = []
      attempts = 0
      backoffUntil = 0
      return
    }
    const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attempts - 1))
    const delay = Math.max(serverMs ?? 0, ceiling / 2 + o.random() * (ceiling / 2))
    backoffUntil = o.now() + delay
    later(() => flush(), delay)
  }

  /* The stats ride along with a batch and are taken back out only once it is accepted. */
  const body = (events: readonly OutEvent[], sentStats: typeof stats | null) =>
    JSON.stringify({
      schema_version: 1,
      site_id: o.site,
      sent_at: new Date(o.now()).toISOString(),
      sdk: o.sdk,
      ...(sentStats ? { stats: sentStats } : {}),
      events,
    })

  /* Taken stats leave the counters at once, so an overlapping send cannot report them again;
     a send that fails gives them back for the next one. */
  const takeStats = () => {
    if (stats.dropped === 0 && stats.retried === 0) return null
    const taken = { ...stats, queued: queue.length }
    stats.dropped = 0
    stats.retried = 0
    return taken
  }
  const giveBack = (taken: typeof stats | null) => {
    if (!taken) return
    stats.dropped += taken.dropped
    stats.retried += taken.retried
  }

  const post = async (events: OutEvent[], sentStats: typeof stats | null) => {
    const gen = generation
    const controller = new AbortController()
    inflight.add(controller)
    try {
      const res = await o.fetchImpl(url, {
        method: 'POST',
        body: body(events, sentStats),
        keepalive: true,
        credentials: 'omit',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        signal: controller.signal,
      })
      if (gen !== generation) return
      if (res.ok) {
        attempts = 0
        const reply = (await res.json().catch(() => ({}))) as { visit_id?: string }
        if (reply.visit_id) o.onVisit(reply.visit_id)
        o.onDelivery?.(events, null)
        return
      }
      giveBack(sentStats)
      if (res.status === 429 || res.status >= 500) {
        stats.retried += events.length
        requeue(events)
        backOff(retryAfterMs(res.headers.get('Retry-After'), o.now()))
        return
      }
      // Any other refusal will not change on retry.
      stats.dropped += events.length
      o.onDelivery?.(events, `status_${res.status}`)
    } catch {
      if (gen !== generation) return
      giveBack(sentStats)
      stats.retried += events.length
      requeue(events)
      backOff(null)
    } finally {
      inflight.delete(controller)
    }
  }

  const cancel = () => {
    generation += 1
    buffer = []
    queue = []
    stats = { dropped: 0, retried: 0, queued: 0 }
    attempts = 0
    backoffUntil = 0
    cancelTimer?.()
    cancelTimer = null
    for (const c of inflight) c.abort()
    inflight.clear()
  }

  function flush(beacon = false): void {
    if (!o.maySend()) return cancel()
    if (!beacon && o.held()) return
    if (!beacon && o.now() < backoffUntil) {
      requeue(buffer)
      buffer = []
      return
    }
    const pending = queue.concat(buffer)
    queue = []
    buffer = []
    if (pending.length === 0) return
    // The envelope is sized with room for stats, so adding them never pushes a batch over the limit.
    const batches = chunk(pending, size(JSON.parse(body([], { dropped: 1e9, retried: 1e9, queued: 1e9 }))))
    batches.forEach((batch, i) => {
      const sentStats = i === 0 ? takeStats() : null
      // The page's exit is the last chance: nothing outlives it, so one beacon even while backing off.
      if (beacon && o.beaconImpl) {
        if (!o.beaconImpl(url, body(batch, sentStats))) {
          giveBack(sentStats)
          requeue(batch)
        }
        return
      }
      void post(batch, sentStats)
    })
  }

  return {
    enqueue(e: OutEvent, immediate = false): void {
      if (!o.maySend()) return cancel()
      // While backing off, events wait in the bounded retry queue for the scheduled retry.
      if (o.now() < backoffUntil) return requeue([e])
      buffer.push(e)
      if (immediate) return flush()
      if (!cancelTimer) later(() => flush(), BATCH_DELAY_MS)
    },
    flush,
    cancel,
  }
}
