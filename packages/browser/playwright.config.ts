import { defineConfig, devices } from '@playwright/test'

const PORT = 4173

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1, // one shared fake collector
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /bfcache\.spec/ },
    // The default headless shell never keeps pages in bfcache, and Playwright passes
    // --disable-back-forward-cache: this project uses full Chromium (new headless) without it.
    // It runs in its own `playwright test` call (see package.json), so each run uses one browser.
    {
      name: 'bfcache',
      testMatch: /bfcache\.spec/,
      use: { ...devices['Desktop Chrome'], channel: 'chromium', launchOptions: { ignoreDefaultArgs: ['--disable-back-forward-cache'] } },
    },
  ],
  webServer: { command: `node build.mjs && node e2e/server.mjs ${PORT}`, port: PORT, reuseExistingServer: false },
})
