import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests against a production build of the site, reading the local
 * Supabase stand-in in e2e/stack (never a real project). e2e/run.sh starts the
 * stack, builds against it and runs these; CI does the same.
 *
 * One worker: the tests share one database and some write to it.
 */
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx next start -p 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } }],
})
