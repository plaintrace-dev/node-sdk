import { expect, test } from '@playwright/test'
import { events, expectEvents, ready, reset } from './helpers'

test.beforeEach(({ request }) => reset(request))

test('a bfcache restore is one page view marked restore', async ({ page, request }) => {
  await page.goto('/fixtures/bfcache-a.html')
  await ready(page)
  await expectEvents(request, ['page_view:load'])
  await page.click('#to-b')
  await page.waitForURL(/bfcache-b/)
  await page.goBack()
  await page.waitForFunction(() => (window as any).__persisted !== undefined)
  const restored = await page.evaluate(() => (window as any).__persisted === true)
  // Headless Chromium may not keep pages in bfcache; then the back navigation is a fresh load.
  test.skip(!restored, 'the page was not served from bfcache in this browser run')
  await expect.poll(async () => (await events(request)).filter((e) => e.type === 'page_view').map((e) => e.navigation), { timeout: 10_000 }).toEqual(['load', 'restore'])
})
