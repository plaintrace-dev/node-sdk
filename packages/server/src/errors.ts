/** A failure the collector reported, or one on the way to it. */
export class ClientError extends Error {
  readonly code: string
  /** The collector's HTTP status, or null when it was not reached. */
  readonly status: number | null

  constructor(code: string, message: string, status: number | null = null, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ClientError'
    this.code = code
    this.status = status
  }
}

/** Reads the collector's {"error":{"code"}} body into a ClientError. */
export async function errorFrom(res: Response): Promise<ClientError> {
  let code = `HTTP_${res.status}`
  try {
    const body = (await res.json()) as { error?: { code?: string } }
    if (body.error?.code) code = body.error.code
  } catch {}
  return new ClientError(code, `collector answered ${res.status} (${code})`, res.status)
}
