import { expect, test } from '@playwright/test'
import { events, expectEvents, ready, reset } from './helpers'

test.beforeEach(({ request }) => reset(request))

test('a load and a custom event', async ({ page, request }) => {
  await page.goto('/fixtures/basic.html')
  await ready(page)
  await expectEvents(request, ['page_view:load'])
  await page.evaluate(() => (window as any).px('track', 'signup', { plan: 'pro' }))
  await expectEvents(request, ['page_view:load', 'custom_event'])
  const [pv, signup] = await events(request)
  expect(pv!.page!.url).toBe('http://localhost:4173/fixtures/basic.html')
  expect(signup!.name).toBe('signup')
})

test('an automated browser without debug sends nothing', async ({ page, request }) => {
  await page.goto('/fixtures/nodebug.html')
  await page.waitForTimeout(4_000)
  expect(await events(request)).toEqual([])
})
