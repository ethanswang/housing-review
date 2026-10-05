import { describe, expect, it } from 'vitest'
import { bedroomLabel, bedroomList, bedroomRange, rentRange } from './format'

describe('bedroom labels', () => {
  it('calls 0 bedrooms a studio, never "0 BR"', () => {
    expect(bedroomLabel(0)).toBe('Studio')
    expect(bedroomLabel(2)).toBe('2 BR')
  })

  it('summarises a range for a result row', () => {
    expect(bedroomRange([])).toBeNull()
    expect(bedroomRange([0])).toBe('Studio')
    expect(bedroomRange([2])).toBe('2 BR')
    expect(bedroomRange([3, 1, 2])).toBe('1–3 BR')
    expect(bedroomRange([2, 0])).toBe('Studio–2 BR')
  })

  it('lists every size for the property page', () => {
    expect(bedroomList([0, 1, 2])).toBe('Studio, 1, 2')
    expect(bedroomList([])).toBe('Not listed')
  })
})

describe('rentRange', () => {
  it('shows a range, or one price when both ends match', () => {
    expect(rentRange(875, 1250)).toBe('$875–1,250/mo')
    expect(rentRange(900, 900)).toBe('$900/mo')
  })

  it('is null when the rent is not known, rather than inventing one', () => {
    expect(rentRange(null, null)).toBeNull()
  })
})
