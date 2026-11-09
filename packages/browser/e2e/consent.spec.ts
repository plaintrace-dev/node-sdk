import { expect, test } from '@playwright/test'
import { events, expectEvents, ready, reset } from './helpers'

test.beforeEach(({ request }) => reset(request))

test('nothing before consent, the page view on grant, nothing after denial', async ({ page, request }) => {
  await page.goto('/fixtures/consent.html')
  await ready(page)
  await page.waitForTimeout(3_500)
  expect(await events(request)).toEqual([])
  await page.evaluate(() => (window as any).px('consent', 'granted'))
  await expectEvents(request, ['page_view:load'])
  await page.evaluate(() => {
    ;(window as any).px('consent', 'denied')
    ;(window as any).px('track', 'after_denial')
  })
  await page.waitForTimeout(2_000)
  expect((await events(request)).map((e) => e.type)).toEqual(['page_view'])
})
