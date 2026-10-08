import { expect, test, type Page } from '@playwright/test'
import { gotoHydrated, signIn } from './helpers'

/** Posts a review as a new student and returns its text, so another account can report it. */
async function postReview(page: Page, path: string) {
  const body = `e2e report target ${Date.now()}: the hallway lights were out for weeks.`
  const form = page.locator('#write-review form')
  await gotoHydrated(page, path)
  await form.locator('input[name="lease_term"]').fill('2024-25')
  for (const name of ['overall', 'maintenance', 'communication', 'value']) {
    await form.locator(`input[name="${name}"][value="3"] + span`).click()
  }
  await form.locator('textarea[name="body"]').fill(body)
  await form.getByRole('button', { name: 'Post review' }).click()
  await expect(page.locator('#write-review').getByRole('status')).toContainText('You have reviewed this building.')
  return body
}

test('a signed-in student can report a review, once', async ({ browser }) => {
  const author = await browser.newContext()
  await signIn(author)
  const body = await postReview(await author.newPage(), '/properties/green-street-towers')

  const reader = await browser.newContext()
  await signIn(reader)
  const page = await reader.newPage()
  await gotoHydrated(page, '/properties/green-street-towers')
  const review = page.locator('article', { hasText: body })
  await review.getByText('Report', { exact: true }).click()
  await review.getByLabel('Not written by someone who lived here').check()
  await review.getByLabel('Anything a moderator should know (optional)').fill('Posted by the leasing office, I think.')
  await review.getByRole('button', { name: 'Send report' }).click()
  await expect(review.getByRole('status')).toHaveText('Reported. A moderator will look at it.')

  // A second report from the same account is accepted quietly, not an error.
  await page.reload()
  await page.locator('[data-hydrated]').first().waitFor({ state: 'attached' })
  await review.getByText('Report', { exact: true }).click()
  await review.getByLabel('Spam or advertising').check()
  await review.getByRole('button', { name: 'Send report' }).click()
  await expect(review.getByRole('status')).toHaveText('Reported. A moderator will look at it.')
})

test('a reader who is not signed in is asked to sign in to report', async ({ browser }) => {
  const author = await browser.newContext()
  await signIn(author)
  const body = await postReview(await author.newPage(), '/properties/bankier-apartments')

  const page = await (await browser.newContext()).newPage()
  await page.goto('/properties/bankier-apartments')
  const review = page.locator('article', { hasText: body })
  await review.getByText('Report', { exact: true }).click()
  await expect(review.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', /^\/signin\?next=/)
  await expect(review.getByRole('button', { name: 'Send report' })).toHaveCount(0)
})

test('sample reviews offer no report', async ({ page }) => {
  await page.goto('/properties/here-champaign')
  await expect(page.locator('article').first()).toBeVisible()
  await expect(page.getByText('Report', { exact: true })).toHaveCount(0)
})
