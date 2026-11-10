import { expect, test } from '@playwright/test'
import { events, expectEvents, ready, reset } from './helpers'

// Runs in the 'bfcache' project (playwright.config.ts): full Chromium with bfcache allowed.
test.beforeEach(({ request }) => reset(request))

test('a bfcache restore is one page view marked restore', async ({ page, request }) => {
  await page.goto('/fixtures/bfcache-a.html')
  await ready(page)
  await expectEvents(request, ['page_view:load'])
  await page.click('#to-b')
  await page.waitForURL(/bfcache-b/)
  // A page restored from bfcache fires no load event: wait for the navigation to commit only.
  await page.goBack({ waitUntil: 'commit' })
  await page.waitForFunction(() => (window as any).__persisted !== undefined)
  expect(await page.evaluate(() => (window as any).__persisted)).toBe(true)
  await expect.poll(async () => (await events(request)).filter((e) => e.type === 'page_view').map((e) => e.navigation), { timeout: 10_000 }).toEqual(['load', 'restore'])
})
