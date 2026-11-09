export const KEY = 'sk_live_0123456789abcdefghijABCDEFGHIJ01'
export const ENDPOINT = 'https://collector.test'
export const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
export const GPTBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)'

export interface Captured {
  url: string
  method: string
  headers: Headers
  body: string
}

/** A fetch that records each request and answers with respond(). */
export function fakeFetch(respond: (c: Captured) => Response | Promise<Response> = () => new Response('{"accepted":1}', { status: 202 })) {
  const calls: Captured[] = []
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init)
    const c = { url: req.url, method: req.method, headers: req.headers, body: await req.text() }
    calls.push(c)
    return respond(c)
  }
  return { fn: fn as typeof fetch, calls }
}
