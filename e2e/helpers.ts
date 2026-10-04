import { createPrivateKey, randomUUID, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { BrowserContext, Locator, Page } from '@playwright/test'
import { RENT_SLIDER_PAUSE_MS } from '../lib/filters'

/**
 * Waits until the page's interactive component has hydrated. page.goto
 * resolves on `load`, which can come before React attaches its handlers;
 * acting earlier types into inputs React is not listening to, and a test then
 * fails, or passes for the wrong reason. FilterRail and ReviewForm set
 * data-hydrated in an effect, which runs only after React has committed.
 */
export async function gotoHydrated(page: Page, path: string) {
  await page.goto(path)
  await page.locator('[data-hydrated]').first().waitFor({ state: 'attached' })
}

/**
 * Long enough for a pending slider change to have applied, if one were going
 * to: well past the slider's pause, then until the network is quiet. Used to
 * check that nothing else happens after an action.
 */
export async function afterSliderPause(page: Page) {
  await page.waitForTimeout(RENT_SLIDER_PAUSE_MS * 3)
  await page.waitForLoadState('networkidle')
}

/** Adds round-trip latency to every request, so a navigation stays in flight long enough to race. */
export async function slowNetwork(page: Page, latencyMs: number) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: latencyMs,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })
}

/**
 * Sets a range input the way assistive technology does: the value changes and
 * an `input` event fires, with no pointer, touch or key events at all.
 */
export async function setRange(slider: Locator, value: number) {
  await slider.evaluate((el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, String(v))
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

/** The current query string, decoded, for readable assertions. */
export const query = (page: Page) => page.evaluate(() => decodeURIComponent(location.search))

/** Distinct property links in the results list. */
export async function resultCount(page: Page) {
  const hrefs = await page.locator('section[aria-label="Results"] a[href^="/properties/"]').evaluateAll((links) =>
    links.map((a) => a.getAttribute('href'))
  )
  return new Set(hrefs).size
}

/**
 * Signs the browser in as a new student, as the emailed code would: a session
 * cookie holding a token signed with the stack's test-only key, which both the
 * site and the API check against the gateway's jwks.json. Returns the email.
 */
export async function signIn(context: BrowserContext): Promise<string> {
  const id = randomUUID()
  const email = `e2e-${id.slice(0, 8)}@illinois.edu`
  const now = Math.floor(Date.now() / 1000)
  const jwk = JSON.parse(readFileSync('e2e/stack/auth-key.json', 'utf8'))
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const unsigned = `${b64({ alg: 'ES256', typ: 'JWT', kid: jwk.kid })}.${b64({
    // The issuer the API in the stack expects; the site does not check it.
    iss: 'https://gateway:54322/auth/v1',
    aud: 'authenticated',
    role: 'authenticated',
    sub: id,
    email,
    is_anonymous: false,
    amr: [{ method: 'otp', timestamp: now }],
    iat: now,
    exp: now + 3600,
  })}`
  const signature = sign('sha256', Buffer.from(unsigned), {
    key: createPrivateKey({ key: jwk, format: 'jwk' }),
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url')
  const session = {
    access_token: `${unsigned}.${signature}`,
    refresh_token: 'e2e-unused',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    user: { id, email, aud: 'authenticated', role: 'authenticated' },
  }
  await context.addCookies([
    { name: 'sb-localhost-auth-token', value: `base64-${b64(session)}`, url: 'http://localhost:3100' },
  ])
  return email
}
