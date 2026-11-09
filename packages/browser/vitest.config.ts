import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: { __VERSION__: '"0.0.0-test"' },
  test: { include: ['test/**/*.test.ts'], environment: 'happy-dom', setupFiles: ['test/setup.ts'], environmentOptions: { happyDOM: { url: 'https://a.com/' } } },
})
