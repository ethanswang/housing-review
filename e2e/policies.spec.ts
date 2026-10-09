import { expect, test } from '@playwright/test'

test('the footer leads to the guidelines, terms, privacy and contact', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('contentinfo').getByRole('link', { name: 'Guidelines, terms & privacy' }).click()
  await expect(page).toHaveURL('/policies')
  for (const heading of ['Community guidelines', 'Terms of use', 'Privacy', 'Contact']) {
    await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible()
  }
  await expect(page.locator('#contact').getByRole('link', { name: 'contact@uiuchousing.com' }))
    .toHaveAttribute('href', 'mailto:contact@uiuchousing.com')
})

test('the sign-in page points to the privacy section', async ({ page }) => {
  await page.goto('/signin')
  await expect(page.getByRole('main').getByRole('link', { name: 'privacy' })).toHaveAttribute('href', '/policies#privacy')
})
