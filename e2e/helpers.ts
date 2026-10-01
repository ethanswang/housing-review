import type { Locator, Page } from '@playwright/test'
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
