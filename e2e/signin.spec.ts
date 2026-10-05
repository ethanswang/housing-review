import { expect, test } from '@playwright/test'
import { gotoHydrated } from './helpers'

/**
 * Sign-in, as far as it goes without a real Supabase Auth: the stand-in has none,
 * so a code can never be sent or used here. The full emailed-code flow is checked
 * by hand against the real project.
 */

test('only an Illinois address is accepted', async ({ page }) => {
  await gotoHydrated(page, '/signin')
  await page.getByLabel('Illinois email').fill('someone@gmail.com')
  await page.getByRole('button', { name: 'Email me a code' }).click()
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Use your @illinois.edu email address.')
})

test('a failed send says so instead of claiming an email went out', async ({ page }) => {
  await gotoHydrated(page, '/signin')
  await page.getByLabel('Illinois email').fill('netid@illinois.edu')
  await page.getByRole('button', { name: 'Email me a code' }).click()
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Could not send the email. Try again.')
})

test('a forged session cookie does not sign anyone in', async ({ page, context }) => {
  // A token claiming an email, signed by nobody: what someone could put in their own cookie.
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '00000000-0000-0000-0000-000000000001', email: 'forged@illinois.edu', exp: 4102444800 })}.c2ln`
  const session = { access_token: token, refresh_token: 'x', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user: { id: '00000000-0000-0000-0000-000000000001', email: 'forged@illinois.edu' } }
  await context.addCookies([{ name: 'sb-localhost-auth-token', value: `base64-${b64(session)}`, url: 'http://localhost:3100' }])

  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByText('forged@illinois.edu')).toHaveCount(0)
})
