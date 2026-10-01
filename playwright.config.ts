import { execFileSync } from 'node:child_process'
import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests against a production build of the site, reading the local
 * Supabase stand-in in e2e/stack, never a real project.
 *
 * The web server builds the site itself, against the stand-in, every run. A
 * Next build bakes NEXT_PUBLIC_* values in, so serving whatever build was
 * already in .next could point the review-posting tests at the real project
 * in .env.local. For the same reason a server already on the port is never
 * reused, and any other Supabase URL in the environment is refused.
 *
 * One worker: the tests share one database and some write to it.
 */
const STAND_IN_URL = 'http://localhost:54321'
const LOCAL_API_URL = 'http://localhost:53001'
for (const [name, local] of [['NEXT_PUBLIC_SUPABASE_URL', STAND_IN_URL], ['API_URL', LOCAL_API_URL]]) {
  const configured = process.env[name]
  if (configured && configured !== local) {
    throw new Error(`e2e tests only run against ${local} for ${name}, not ${configured}`)
  }
}
const anonKey = execFileSync('node', ['e2e/stack/anon-key.mjs']).toString()

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
    command: 'npx next build && npx next start -p 3100',
    env: { NEXT_PUBLIC_SUPABASE_URL: STAND_IN_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey, API_URL: LOCAL_API_URL },
    url: 'http://localhost:3100',
    reuseExistingServer: false,
    timeout: 240_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } }],
})
