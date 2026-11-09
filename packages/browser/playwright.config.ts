import { defineConfig, devices } from '@playwright/test'

const PORT = 4173

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1, // one shared fake collector
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: `node build.mjs && node e2e/server.mjs ${PORT}`, port: PORT, reuseExistingServer: false },
})
