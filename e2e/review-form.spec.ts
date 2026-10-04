import { expect, test, type Page } from '@playwright/test'
import { gotoHydrated, signIn } from './helpers'

/**
 * The review form on a property page, signed in with the stack's test key.
 * These post through the e2e stack's API, never to a real project.
 */

test.beforeEach(async ({ context }) => {
  await signIn(context)
})

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

test('a refusal from the API is a message on the form, keeping the review', async ({ page }) => {
  await gotoHydrated(page, '/properties/lofts-54')
  await fill(page, '2024-25', 'The first review from this account, long enough to post.')
  await form(page).getByRole('button', { name: 'Post review' }).click()
  await expect(page.getByRole('status')).toHaveText(/your review is live/)

  await gotoHydrated(page, '/properties/lofts-54')
  const second = 'A second review of the same building, which the API refuses.'
  await fill(page, '2025-26', second)
  await form(page).getByRole('button', { name: 'Post review' }).click()
  await expect(form(page).getByRole('alert')).toHaveText('You have already reviewed this building.')
  await expect(form(page).locator('textarea[name="body"]')).toHaveValue(second)
})

test('a forged building slug is refused before it reaches the API', async ({ page }) => {
  await gotoHydrated(page, '/properties/lofts-54')
  await fill(page, '2024-25', 'A body long enough to pass validation on the server.')
  await page.evaluate(() => {
    document.querySelector<HTMLInputElement>('#write-review input[name="slug"]')!.value = '..'
  })
  await form(page).getByRole('button', { name: 'Post review' }).click()
  await expect(form(page).getByRole('alert')).toHaveText('Something went wrong. Please reload and try again.')
})

test('a valid review is posted and shown', async ({ page }) => {
  await gotoHydrated(page, '/properties/campus-circle')
  const marker = `e2e review ${Date.now()}: the laundry room was always open.`
  await fill(page, '2025-26', marker)
  await form(page).getByRole('button', { name: 'Post review' }).click()
  await expect(page.getByRole('status')).toHaveText(/your review is live/)
  await page.reload()
  await expect(page.getByText(marker)).toBeVisible()
})

test('a visitor who is not signed in is asked to sign in, and comes back to the form', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage()
  await page.goto('/properties/campus-circle')
  await expect(form(page)).toHaveCount(0)
  await page.getByRole('link', { name: 'Sign in with your @illinois.edu email' }).click()
  await expect(page).toHaveURL('/signin?next=%2Fproperties%2Fcampus-circle%23write-review')
})
