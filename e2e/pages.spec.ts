import { expect, test } from '@playwright/test'

/**
 * Real status codes. A loading.tsx above a page makes it answer 200 even when
 * it calls notFound(), which shipped once (#25) and was fixed in #27.
 */
test('known pages answer 200 and unknown slugs a real 404', async ({ page }) => {
  for (const [path, status] of [
    ['/', 200],
    ['/properties/lofts-54', 200],
    ['/companies/jsm', 200],
    ['/properties/does-not-exist', 404],
    ['/companies/does-not-exist', 404],
  ] as const) {
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(status)
  }
})
