import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4321' },
  webServer: {
    command: 'npx astro preview --port 4321',
    url: 'http://localhost:4321',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium-375', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 800 } } },
    { name: 'chromium-1280', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
})
