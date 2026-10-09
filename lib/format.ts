/** How bedroom counts read on the page. 0 is a studio, never "0 BR". */

export function bedroomLabel(count: number): string {
  return count === 0 ? 'Studio' : `${count} BR`
}

/** "Studio", "2 BR", "1–3 BR" or "Studio–2 BR"; null when none are listed. */
export function bedroomRange(bedrooms: number[]): string | null {
  if (!bedrooms.length) return null
  const min = Math.min(...bedrooms)
  const max = Math.max(...bedrooms)
  if (min === max) return bedroomLabel(min)
  return `${min === 0 ? 'Studio' : min}–${max} BR`
}

/** Every size, for the property page: "Studio, 1, 2", or "Not listed". */
export function bedroomList(bedrooms: number[]): string {
  if (!bedrooms.length) return 'Not listed'
  return bedrooms.map((count) => (count === 0 ? 'Studio' : String(count))).join(', ')
}

export type RentBasis = 'bed' | 'unit' | 'mixed' | null

const BASIS: Record<Exclude<RentBasis, null>, string> = {
  bed: ' per bed',
  unit: ' per unit',
  mixed: ' per bed or unit',
}

/**
 * "$875–1,250/mo per bed", "$900/mo per unit", or null when the rent is not
 * known. The basis matters: near campus a per-bed price is a fraction of the
 * unit's, so it is shown whenever the listing said which.
 */
export function rentRange(min: number | null, max: number | null, basis: RentBasis = null): string | null {
  if (min === null || max === null) return null
  const amount = min === max ? `$${min.toLocaleString('en-US')}` : `$${min.toLocaleString('en-US')}–${max.toLocaleString('en-US')}`
  return `${amount}/mo${basis ? BASIS[basis] : ''}`
}

/** "36 units · 3 stories", either half alone, or null when neither is known. */
export function sizeLabel(units: number | null, stories: number | null): string | null {
  const parts = [
    units ? `${units} ${units === 1 ? 'unit' : 'units'}` : null,
    stories ? `${stories} ${stories === 1 ? 'story' : 'stories'}` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}
