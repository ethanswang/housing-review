import { describe, expect, it } from 'vitest'
import { averageRatings, sortProperties, type RatingRow } from './stats'
import type { PropertyWithStats } from './types'

const review = (overall: number): RatingRow => ({ overall, maintenance: overall, communication: overall, value: overall })

describe('averageRatings', () => {
  it('is null for every category when there are no reviews', () => {
    expect(averageRatings([])).toEqual({ overall: null, maintenance: null, communication: null, value: null })
  })

  it('averages a company over all its reviews at once, as the API does', () => {
    // Two buildings: [4, 3, 4] and [2, 3, 1]. Over all six reviews the mean is
    // 17/6 = 2.83 → 2.8, which is what company_stats returns. Averaging each
    // building first (3.7 and 2.0) and weighting by count gave 2.9.
    const company = [4, 3, 4, 2, 3, 1].map(review)
    expect(averageRatings(company).overall).toBe(2.8)
  })

  it('rounds to one decimal place', () => {
    expect(averageRatings([4, 4, 5].map(review)).overall).toBe(4.3)
  })
})

describe('sortProperties', () => {
  const property = (slug: string, overall: number | null, rent = 800, reviewCount = 1) =>
    ({
      slug,
      rent_min: rent,
      reviewCount,
      averages: { overall, maintenance: overall, communication: overall, value: overall },
    }) as PropertyWithStats

  const slugs = (list: PropertyWithStats[]) => list.map((p) => p.slug)

  it('breaks ties by slug, so equal scores keep one order', () => {
    const a = property('alpha', 4)
    const b = property('bravo', 4)
    expect(slugs(sortProperties([b, a], 'rating'))).toEqual(['alpha', 'bravo'])
    expect(slugs(sortProperties([a, b], 'rating'))).toEqual(['alpha', 'bravo'])
    expect(slugs(sortProperties([b, a], 'price'))).toEqual(['alpha', 'bravo'])
    expect(slugs(sortProperties([b, a], 'reviews'))).toEqual(['alpha', 'bravo'])
  })

  it('puts unreviewed properties last when sorting by rating', () => {
    const list = [property('none', null), property('low', 1.5), property('high', 4.8)]
    expect(slugs(sortProperties(list, 'rating'))).toEqual(['high', 'low', 'none'])
  })

  it('does not reorder the array it was given', () => {
    const list = [property('b', 1), property('a', 5)]
    sortProperties(list, 'rating')
    expect(slugs(list)).toEqual(['b', 'a'])
  })
})
