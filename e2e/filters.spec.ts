import { expect, test, type Page } from '@playwright/test'
import { RENT_SLIDER_PAUSE_MS } from '../lib/filters'
import { afterSliderPause, gotoHydrated, query, resultCount, setRange, slowNetwork } from './helpers'

/**
 * The directory's filter rail. Several of these reproduce bugs that shipped or
 * nearly shipped (#42 and its review): each failed against the code it guards
 * before the fix.
 */

const rail = (page: Page) => page.locator('aside[aria-label="Filters"]')
const railSlider = (page: Page) => rail(page).locator('input[type=range]')

test.describe('filters write to the URL', () => {
  test('two quick ticks on a slow network keep both', async ({ page }) => {
    await gotoHydrated(page, '/')
    await slowNetwork(page, 1500)
    await rail(page).getByLabel('JSM').click()
    await rail(page).getByLabel('Roland Realty').click()
    // Shown at once, before the server answers...
    await expect(rail(page).getByLabel('JSM')).toBeChecked()
    await expect(rail(page).getByLabel('Roland Realty')).toBeChecked()
    // ...and neither overwrites the other once it does.
    await expect.poll(() => query(page), { timeout: 20_000 }).toBe('?company=jsm,roland-realty')
  })

  test('the rent slider applies from input events alone, as assistive technology sends them', async ({ page }) => {
    await gotoHydrated(page, '/')
    await setRange(railSlider(page), 1000)
    await expect.poll(() => query(page)).toBe('?maxRent=1000')
  })

  test('the rent slider applies from the keyboard', async ({ page }) => {
    await gotoHydrated(page, '/')
    await railSlider(page).focus()
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft')
    await expect.poll(() => query(page)).toBe('?maxRent=1500')
  })
})

test.describe('a slider change waiting out its pause', () => {
  test('is kept when a checkbox is ticked during it', async ({ page }) => {
    await gotoHydrated(page, '/')
    await slowNetwork(page, 1500)
    await setRange(railSlider(page), 1100)
    await rail(page).getByLabel('Campustown').click()
    await expect.poll(() => query(page), { timeout: 20_000 }).toBe('?hood=Campustown&maxRent=1100')
  })

  test('is dropped by Clear all', async ({ page }) => {
    await gotoHydrated(page, '/?hood=Campustown')
    await setRange(railSlider(page), 900)
    await rail(page).getByRole('button', { name: 'Clear all' }).click()
    await expect.poll(() => query(page)).toBe('')
    await afterSliderPause(page) // the rent must not come back
    expect(await query(page)).toBe('')
  })

  test('is dropped by removing the rent chip, kept when removing another', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }) // chips are in the phone bar
    const sheetSlider = page.locator('dialog input[type=range]')

    await gotoHydrated(page, '/?maxRent=1100')
    await setRange(sheetSlider, 900)
    await page.getByRole('button', { name: 'Remove filter: Up to $1,100' }).click()
    await afterSliderPause(page)
    expect(await query(page)).toBe('')

    await gotoHydrated(page, '/?hood=Campustown')
    await setRange(sheetSlider, 900)
    await page.getByRole('button', { name: 'Remove filter: Campustown' }).click()
    await expect.poll(() => query(page)).toBe('?maxRent=900')
  })

  test('does not override Back', async ({ page }) => {
    await gotoHydrated(page, '/')
    await rail(page).getByLabel('Campustown').click()
    await expect.poll(() => query(page)).toBe('?hood=Campustown')
    await setRange(railSlider(page), 1000)
    await page.goBack()
    await expect.poll(() => query(page)).toBe('')
    await afterSliderPause(page)
    expect(await query(page)).toBe('')
  })

  test('does not snap the thumb back when an older navigation lands', async ({ page }) => {
    await gotoHydrated(page, '/')
    await slowNetwork(page, 1500)
    await setRange(railSlider(page), 1000)
    await page.waitForTimeout(RENT_SLIDER_PAUSE_MS + 100) // the first change is applied and in flight
    await setRange(railSlider(page), 1200)
    const samples: number[] = []
    for (let i = 0; i < 18; i++) {
      samples.push(Number(await railSlider(page).inputValue()))
      await page.waitForTimeout(250)
    }
    expect(samples.every((value) => value === 1200)).toBe(true)
    await expect.poll(() => query(page), { timeout: 20_000 }).toBe('?maxRent=1200')
  })

  test("keeps the phone sheet's count from claiming to be current", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoHydrated(page, '/')
    await page.getByRole('button', { name: /^Filters/ }).click()
    const footer = page.locator('dialog').getByRole('button', { name: /Updating|Show \d+/ })
    await setRange(page.locator('dialog input[type=range]'), 700)
    await expect(footer).toHaveText('Updating…')
    await expect(footer).toHaveText(/Show \d+ propert/)
  })
})

test.describe('search', () => {
  test('matches name or address, and treats wildcards and commas literally', async ({ page }) => {
    await gotoHydrated(page, '/?q=Green')
    expect(await resultCount(page)).toBe(5)
    await gotoHydrated(page, '/?q=E%20Green%20St%2C%20Champaign')
    expect(await resultCount(page)).toBe(3)
    for (const literal of ['%25', '_', 'Gr%25en', 'Gr_en']) {
      await gotoHydrated(page, `/?q=${literal}`)
      expect(await resultCount(page), literal).toBe(0)
    }
  })

  test('survives crafted parameters instead of failing the page', async ({ page }) => {
    for (const path of ['/?beds=99999999999', `/?q=${'x'.repeat(7000)}`, '/?q=%00', '/?q=*']) {
      const response = await page.goto(path)
      expect(response?.status(), path.slice(0, 30)).toBe(200)
    }
  })
})

test('a German-locale browser sees the server’s number format, with no hydration warnings', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'de-DE', viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const problems: string[] = []
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) problems.push(message.text())
  })
  page.on('pageerror', (error) => problems.push(error.message))
  await gotoHydrated(page, '/?maxRent=1250')
  expect(await page.evaluate(() => (1250).toLocaleString())).toBe('1.250') // the browser's own format
  await expect(rail(page).getByText('Up to $1,250/mo')).toBeVisible()
  expect(problems).toEqual([])
  await context.close()
})
