const encoder = new TextEncoder()

const hex = (buf: ArrayBuffer): string => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')

const fromHex = (s: string): Uint8Array => Uint8Array.from(s.match(/../g) ?? [], (b) => parseInt(b, 16))

async function hmac(key: Uint8Array, message: Uint8Array): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', k, message as BufferSource)
}

/** The request-signing secret, HMAC-SHA256(key, "sign:v1"), hex. The collector derives it the same way. */
export async function signingSecret(key: string): Promise<string> {
  return hex(await hmac(encoder.encode(key), encoder.encode('sign:v1')))
}

/** The X-Signature header value: "t=<unix>,v1=<hex HMAC of t, method, path and the body's SHA-256>". */
export async function sign(secretHex: string, t: number, method: string, path: string, body: Uint8Array): Promise<string> {
  const bodySum = hex(await crypto.subtle.digest('SHA-256', body as BufferSource))
  const mac = hex(await hmac(fromHex(secretHex), encoder.encode(`${t}\n${method}\n${path}\n${bodySum}`)))
  return `t=${t},v1=${mac}`
}
