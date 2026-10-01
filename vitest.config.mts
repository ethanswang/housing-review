import { defineConfig } from 'vitest/config'

// The site's unit tests: pure functions in lib/. server/ has its own suite,
// which needs a database, and is run from that directory.
export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts'],
  },
})
