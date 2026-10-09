import { describe, expect, it } from 'vitest'
import { bedroomLabel, bedroomList, bedroomRange, rentRange, sizeLabel } from './format'

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

  it('says what the rent is per when the listing did', () => {
    expect(rentRange(1160, 2380, 'bed')).toBe('$1,160–2,380/mo per bed')
    expect(rentRange(1600, 4500, 'unit')).toBe('$1,600–4,500/mo per unit')
    expect(rentRange(920, 1795, 'mixed')).toBe('$920–1,795/mo per bed or unit')
  })

  it('is null when the rent is not known, rather than inventing one', () => {
    expect(rentRange(null, null)).toBeNull()
  })
})

describe('sizeLabel', () => {
  it('shows what is known of the size, in the singular where it should be', () => {
    expect(sizeLabel(36, 3)).toBe('36 units · 3 stories')
    expect(sizeLabel(1, 1)).toBe('1 unit · 1 story')
    expect(sizeLabel(12, null)).toBe('12 units')
    expect(sizeLabel(null, 4)).toBe('4 stories')
    expect(sizeLabel(null, null)).toBeNull()
  })
})
