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

/** "$875–$1,250/mo", "$900/mo", or null when the rent is not known. */
export function rentRange(min: number | null, max: number | null): string | null {
  if (min === null || max === null) return null
  return min === max ? `$${min.toLocaleString('en-US')}/mo` : `$${min.toLocaleString('en-US')}–${max.toLocaleString('en-US')}/mo`
}
