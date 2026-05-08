import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    trace: 'on-first-retry',
    baseURL: process.env.BASE_URL || 'http://localhost:5180',
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

  webServer: {
    command: 'npx vite --port 5180',
    url: 'http://localhost:5180',
    reuseExistingServer: false,
  },
})
