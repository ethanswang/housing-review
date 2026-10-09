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

test('a slug with capitals redirects to the page; one that cannot exist is a 404, not an error', async ({ page, request }) => {
  await page.goto('/properties/Here-Champaign')
  await expect(page).toHaveURL('/properties/here-champaign')
  expect((await request.get('/properties/foo_bar')).status()).toBe(404)
  expect((await request.get('/companies/Bad_Slug')).status()).toBe(404)
})

test('a malformed rent limit in the URL is ignored rather than failing the directory', async ({ request }) => {
  for (const maxRent of ['1500.5', '999999']) {
    const response = await request.get(`/?maxRent=${maxRent}`)
    expect(response.status()).toBe(200)
    expect(await response.text()).not.toContain('This page couldn')
  }
})

test('pages refuse to be framed by other sites', async ({ request }) => {
  const response = await request.get('/')
  expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(response.headers()['x-frame-options']).toBe('DENY')
})
