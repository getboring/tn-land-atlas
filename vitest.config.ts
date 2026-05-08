import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// Vitest is for unit tests of pure modules (src/lib/*.test.ts).
// Playwright owns e2e/* — keep them out of the vitest run.
export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
})
