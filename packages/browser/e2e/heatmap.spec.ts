import { expect, test } from '@playwright/test'
import { events, ready, reset } from './helpers'

const link = (prefix: string, api = 'http%3A%2F%2Flocalhost%3A4173') => `/fixtures/heatmap.html#pt-heatmap=${prefix}-0000-4000-8000-000000000000.1794381597515.${'a'.repeat(43)}&api=${api}`

test.beforeEach(({ request }) => reset(request))

test('real clicks are recorded with their element and box position; a click that does nothing is dead', async ({ page, request }) => {
  await page.goto('/fixtures/heatmap.html')
  await ready(page)
  await page.click('#buy', { position: { x: 50, y: 10 } })
  await page.click('#price')
  await expect.poll(async () => (await events(request)).filter((e) => e.type === 'click').length, { timeout: 10_000 }).toBe(2)
  const clicks = (await events(request)).filter((e) => e.type === 'click') as any[]
  // Playwright's position is inside the border; the tracker measures the whole box.
  const want = await page.evaluate(() => {
    const b = document.getElementById('buy')!
    const r = b.getBoundingClientRect()
    return { x: Math.round(((b.clientLeft + 50) / r.width) * 1000), y: Math.round(((b.clientTop + 10) / r.height) * 1000) }
  })
  expect(clicks[0].click).toMatchObject({ selector: '#buy', ...want, viewport: 'desktop', rage: false })
  expect(clicks[1].click).toMatchObject({ selector: '#price', dead: true })
})

test('the overlay draws on the page, says what it could not place, and measures nothing', async ({ page, request }) => {
  await page.goto(link('11111111'))
  const stats = page.locator('pt-heatmap .stats')
  await expect(stats).toContainText('8 clicks')
  await expect(stats).toContainText('25% of clicks are not on this page as it is now')
  await expect(page.locator('pt-heatmap .badge.rage')).toHaveText('rage 2')
  expect(page.url()).not.toContain('pt-heatmap')
  // The heat is drawn on #buy: the canvas has colour at the centre of its cell.
  const alpha = await page.evaluate(() => {
    const canvas = document.querySelector('pt-heatmap')!.shadowRoot!.querySelector('canvas')!
    const b = document.getElementById('buy')!.getBoundingClientRect()
    const x = Math.round(b.left + scrollX + b.width * 0.525)
    const y = Math.round(b.top + scrollY + b.height * 0.525)
    return canvas.getContext('2d')!.getImageData(x, y, 1, 1).data[3]
  })
  expect(alpha).toBeGreaterThan(0)
  await page.click('#buy')
  await page.waitForTimeout(1_500)
  expect(await events(request)).toEqual([])
})

test('an expired link says so', async ({ page }) => {
  await page.goto(link('00000000'))
  await expect(page.locator('pt-heatmap .stats')).toContainText('expired')
})

test('hostile data from the API is shown as text, never run', async ({ page }) => {
  await page.goto(link('eeeeeeee'))
  await expect(page.locator('pt-heatmap .stats')).toContainText('0 page views')
  await expect(page.locator('pt-heatmap .stats code')).toHaveText('<img src=x onerror="window.__xss=2">')
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined()
  expect(await page.locator('pt-heatmap').evaluate((h) => h.shadowRoot!.querySelectorAll('img').length)).toBe(0)
})

test('a link naming another API than the site\'s dashboard opens no overlay', async ({ page }) => {
  await page.goto(link('11111111', 'https%3A%2F%2Fevil.test'))
  await page.waitForTimeout(1_500)
  expect(await page.locator('pt-heatmap').count()).toBe(0)
})
