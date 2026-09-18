import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Schema tests share one Postgres and isolate themselves with transactions,
    // so they must not run in parallel across files.
    fileParallelism: false,
    include: ['tests/**/*.test.ts'],
  },
})
