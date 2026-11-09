import { ClientError, errorFrom } from './errors.js'
import { sign, signingSecret } from './sign.js'

export interface Context {
  readonly key: string
  readonly endpoint: string
  readonly fetch: typeof fetch
  readonly clientIp: (req: Request) => string | null
  readonly onError: (error: unknown) => void
  readonly timeoutMs: number
  readonly measureLoss: boolean
  readonly secret: Promise<string>
}

export function makeContext(o: {
  key: string
  endpoint: string
  fetch: typeof fetch
  clientIp: (req: Request) => string | null
  onError: (error: unknown) => void
  timeoutMs: number
  measureLoss: boolean
}): Context {
  return { ...o, endpoint: o.endpoint.replace(/\/+$/, ''), secret: signingSecret(o.key) }
}

/** Headers that authenticate one request to the collector. */
export async function authHeaders(ctx: Context, method: string, path: string, body: Uint8Array): Promise<Record<string, string>> {
  const t = Math.floor(Date.now() / 1000)
  return { authorization: `Bearer ${ctx.key}`, 'x-signature': await sign(await ctx.secret, t, method, path, body) }
}

/** POSTs a signed JSON body to the collector; resolves to the response or rejects with ClientError. */
export async function postSigned(ctx: Context, path: string, payload: unknown): Promise<Response> {
  const body = new TextEncoder().encode(JSON.stringify(payload))
  let res: Response
  try {
    res = await ctx.fetch(`${ctx.endpoint}${path}`, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', ...(await authHeaders(ctx, 'POST', path, body)) },
      signal: AbortSignal.timeout(ctx.timeoutMs),
    })
  } catch (cause) {
    throw new ClientError('NETWORK_ERROR', 'The collector could not be reached.', null, { cause })
  }
  if (!res.ok) throw await errorFrom(res)
  return res
}

/** Calls the error handler without letting it throw into the site's request. */
export function report(ctx: Context, error: unknown): void {
  try {
    ctx.onError(error)
  } catch {}
}
