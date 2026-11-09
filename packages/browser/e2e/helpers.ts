import { expect, type Page, type APIRequestContext } from '@playwright/test'

export interface Ev { type: string; navigation?: string; name?: string; page?: { url: string } }

export const events = async (request: APIRequestContext): Promise<Ev[]> => (await request.get('/__events')).json()
export const reset = (request: APIRequestContext) => request.delete('/__events')

/** Waits until the collector has seen events matching `want` (type or type:navigation). */
export async function expectEvents(request: APIRequestContext, want: string[]) {
  await expect.poll(async () => (await events(request)).map((e) => (e.navigation ? `${e.type}:${e.navigation}` : e.type)), { timeout: 10_000 }).toEqual(want)
}

export const ready = (page: Page) => page.waitForFunction(() => (window as any).px?.__px === true)
