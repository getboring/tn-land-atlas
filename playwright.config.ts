import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.BASE_URL || 'http://localhost:5180'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    trace: 'on-first-retry',
    baseURL,
    ignoreHTTPSErrors: true,
  },

  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-tablet',
      use: { ...devices['iPad Mini'] },
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['iPhone 14'] },
    },
  ],

  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'npm run build && npx wrangler pages dev dist --port 5180 --ip 127.0.0.1 --log-level error',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
      },
})
