import { expect, test, type Page } from '@playwright/test'
import { gotoHydrated } from './helpers'

/**
 * The review form on a property page. These write to the e2e database, never
 * to a real project.
 */

const form = (page: Page) => page.locator('#write-review form')

async function fill(page: Page, leaseTerm: string, body: string) {
  await form(page).locator('input[name="lease_term"]').fill(leaseTerm)
  for (const [name, value] of [['overall', 4], ['maintenance', 3], ['communication', 5], ['value', 2]] as const) {
    // The radios are visually hidden; click the visible number, as a person would.
    await form(page).locator(`input[name="${name}"][value="${value}"] + span`).click()
  }
  await form(page).locator('textarea[name="body"]').fill(body)
}

/** Which radio is checked, and which button looks selected, for each rating. */
async function ratings(page: Page) {
  return form(page).evaluate((f) =>
    ['overall', 'maintenance', 'communication', 'value'].map((name) => {
      const checked = f.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? null
      const lit = [...f.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)]
        .filter((input) => getComputedStyle(input.nextElementSibling!).backgroundColor !== 'rgb(255, 255, 255)')
        .map((input) => input.value)
      return { name, checked, lit }
    })
  )
}

test('a server-side error keeps everything typed, and what looks selected is what is checked', async ({ page }) => {
  await gotoHydrated(page, '/properties/lofts-54')
  const body = 'Radiators were loud but the office answered every time.'
  // Passes the browser's `required`, fails the server's trim: React resets the
  // form after the action, so before #33 this wiped the review.
  await fill(page, '   ', body)
  await form(page).getByRole('button', { name: 'Post review' }).click()
  await expect(form(page).getByRole('alert')).toHaveText('Please say which lease year this was.')

  await expect(form(page).locator('textarea[name="body"]')).toHaveValue(body)
  await expect(form(page).locator('input[name="lease_term"]')).toHaveValue('   ')
  await expect
    .poll(() => ratings(page))
    .toEqual([
      { name: 'overall', checked: '4', lit: ['4'] },
      { name: 'maintenance', checked: '3', lit: ['3'] },
      { name: 'communication', checked: '5', lit: ['5'] },
      { name: 'value', checked: '2', lit: ['2'] },
    ])
})

test('a database error is a message on the form, not an error page', async ({ page }) => {
  await gotoHydrated(page, '/properties/lofts-54')
  await fill(page, '2024-25', 'A body long enough to pass validation on the server.')
  await page.evaluate(() => {
    document.querySelector<HTMLInputElement>('#write-review input[name="property_id"]')!.value = 'not-a-uuid'
  })
  await form(page).getByRole('button', { name: 'Post review' }).click()
  await expect(form(page).getByRole('alert')).toContainText('couldn’t save your review')
  await expect(form(page).locator('input[name="lease_term"]')).toHaveValue('2024-25')
})

// Reviews are still written to Supabase while pages read the API, so a posted
// review does not appear until writing moves to the API too (feature/api-switch).
test.fixme('a valid review is posted and shown', async ({ page }) => {
  await gotoHydrated(page, '/properties/campus-circle')
  const marker = `e2e review ${Date.now()}: the laundry room was always open.`
  await fill(page, '2025-26', marker)
  await form(page).getByRole('button', { name: 'Post review' }).click()
  await expect(page.getByRole('status')).toHaveText(/your review is live/)
  await page.reload()
  await expect(page.getByText(marker)).toBeVisible()
})
