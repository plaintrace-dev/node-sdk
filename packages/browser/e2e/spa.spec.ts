import { expect, test } from '@playwright/test'
import { events, expectEvents, ready, reset } from './helpers'

test.beforeEach(({ request }) => reset(request))

test('route changes, query-only replaces and back', async ({ page, request }) => {
  await page.goto('/fixtures/spa.html')
  await ready(page)
  await expectEvents(request, ['page_view:load'])
  await page.mouse.wheel(0, 800)
  await page.evaluate(() => history.pushState(null, '', '/fixtures/b'))
  await expectEvents(request, ['page_view:load', 'engagement', 'page_view:soft'])
  await page.evaluate(() => history.replaceState(null, '', '/fixtures/b?x=1'))
  await page.waitForTimeout(2_500)
  await expectEvents(request, ['page_view:load', 'engagement', 'page_view:soft'])
  await page.goBack()
  await expectEvents(request, ['page_view:load', 'engagement', 'page_view:soft', 'engagement', 'page_view:soft'])
  const soft = (await events(request)).filter((e) => e.navigation === 'soft')
  expect(soft.map((e) => new URL(e.page!.url).pathname)).toEqual(['/fixtures/b', '/fixtures/spa.html'])
})

test('leaving the page sends its engagement', async ({ page, request }) => {
  await page.goto('/fixtures/spa.html')
  await ready(page)
  await page.mouse.click(10, 10)
  await expectEvents(request, ['page_view:load'])
  await page.goto('about:blank')
  await expectEvents(request, ['page_view:load', 'engagement'])
})
