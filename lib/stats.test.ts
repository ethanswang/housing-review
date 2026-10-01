import { describe, expect, it } from 'vitest'
import { averageRatings, companyAverages, sortProperties, type RatingRow } from './stats'
import type { PropertyWithStats } from './types'

const review = (overall: number): RatingRow => ({ overall, maintenance: overall, communication: overall, value: overall })

describe('averageRatings', () => {
  it('is null for every category when there are no reviews', () => {
    expect(averageRatings([])).toEqual({ overall: null, maintenance: null, communication: null, value: null })
  })


  it('rounds to one decimal place', () => {
    expect(averageRatings([4, 4, 5].map(review)).overall).toBe(4.3)
  })
})

describe('companyAverages', () => {
  it('averages every review of every building together, as the API does', () => {
    // Buildings [4, 3, 4] and [2, 3, 1]: all six reviews give 17/6 = 2.83 → 2.8,
    // what company_stats returns. Averaging each building first (3.7 and 2.0)
    // and weighting by review count, as the site used to, gave 2.9.
    const buildings = [{ reviews: [4, 3, 4].map(review) }, { reviews: [2, 3, 1].map(review) }]
    expect(companyAverages(buildings).overall).toBe(2.8)
  })

  it('ignores buildings with no reviews instead of counting them as zero', () => {
    const buildings = [{ reviews: [] }, { reviews: [5, 3].map(review) }]
    expect(companyAverages(buildings).overall).toBe(4)
  })

  it('is null when no building has a review', () => {
    expect(companyAverages([{ reviews: [] }]).overall).toBeNull()
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

  it('orders slugs by code point, as SQL `slug asc` does', () => {
    const list = ['ab', 'a9', 'a10', 'a1', 'a-b'].map((slug) => property(slug, 4))
    expect(slugs(sortProperties(list, 'rating'))).toEqual(['a-b', 'a1', 'a10', 'a9', 'ab'])
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
