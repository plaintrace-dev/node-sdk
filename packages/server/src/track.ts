import { postSigned, type Context } from './context.js'
import { ClientError } from './errors.js'

export type PropertyValue = string | number | boolean | null

interface TrackFields {
  /** The page the event belongs to. Defaults to the request's URL. */
  readonly url?: string
  readonly properties?: Readonly<Record<string, PropertyValue>>
  /** Your own id for the signed-in user; the collector stores only its hash. */
  readonly userId?: string
  /** A UUID v7; reuse it when retrying so the event counts once. Minted when absent. */
  readonly eventId?: string
}

export type TrackOptions = TrackFields &
  (
    | { readonly request: Request; readonly ip?: string; readonly visitor?: never }
    | { readonly visitor: { readonly ip: string; readonly userAgent: string; readonly language?: string }; readonly request?: never; readonly ip?: never }
  )

export interface TrackResult {
  readonly accepted: number
  readonly duplicate: number
}

export function uuidV7(now = Date.now()): string {
  const b = crypto.getRandomValues(new Uint8Array(16))
  for (let i = 0; i < 6; i++) b[i] = Math.floor(now / 2 ** (8 * (5 - i))) & 0xff
  b[6] = 0x70 | ((b[6] ?? 0) & 0x0f)
  b[8] = 0x80 | ((b[8] ?? 0) & 0x3f)
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export async function trackEvent(ctx: Context, name: string, o: TrackOptions): Promise<TrackResult> {
  let visitor: { ip: string; user_agent: string; language?: string }
  let url = o.url
  if (o.visitor) {
    visitor = { ip: o.visitor.ip, user_agent: o.visitor.userAgent, ...(o.visitor.language ? { language: o.visitor.language } : {}) }
  } else {
    const ip = o.ip ?? ctx.clientIp(o.request)
    if (!ip) throw new ClientError('CLIENT_IP_UNRESOLVED', 'The visitor address could not be read from the request: pass `ip`.')
    const language = o.request.headers.get('accept-language')
    visitor = { ip, user_agent: o.request.headers.get('user-agent') ?? '', ...(language ? { language } : {}) }
    url ??= o.request.url
  }
  const res = await postSigned(ctx, '/v1/server/events', {
    schema_version: 1,
    visitor,
    events: [
      {
        event_id: o.eventId ?? uuidV7(),
        name,
        ...(url ? { url } : {}),
        ...(o.properties ? { properties: o.properties } : {}),
        ...(o.userId ? { external_user_id: o.userId } : {}),
      },
    ],
  })
  const body = (await res.json()) as TrackResult
  return { accepted: body.accepted, duplicate: body.duplicate }
}
