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

/** Every size, for the property page: "Studio, 1, 2". */
export function bedroomList(bedrooms: number[]): string {
  return bedrooms.map((count) => (count === 0 ? 'Studio' : String(count))).join(', ')
}
