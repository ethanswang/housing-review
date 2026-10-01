import { describe, expect, it } from 'vitest'
import { buildQuery, hasActiveFilters, parseFilters } from './filters'

describe('parseFilters', () => {
  it('keeps a studio (0 bedrooms) as a bedroom filter', () => {
    expect(parseFilters({ beds: '0,2' }).bedrooms).toEqual([0, 2])
  })

  it('drops bedroom values that are not whole numbers from 0 to 20', () => {
    expect(parseFilters({ beds: '-1,1.5,x,3,21,99999999999' }).bedrooms).toEqual([3])
  })

  it('strips control characters from the search and caps it at 100 characters', () => {
    expect(parseFilters({ q: 'Gre\u0000en\n' }).search).toBe('Green')
    expect(parseFilters({ q: '\u0000' }).search).toBeUndefined()
    expect(parseFilters({ q: 'x'.repeat(500) }).search).toHaveLength(100)
  })

  it('defaults the sort and ignores an unknown one', () => {
    expect(parseFilters({}).sort).toBe('rating')
    expect(parseFilters({ sort: 'cheapest' }).sort).toBe('rating')
  })

  it('ignores a max rent that is not a positive number', () => {
    expect(parseFilters({ maxRent: '0' }).maxRent).toBeUndefined()
    expect(parseFilters({ maxRent: 'abc' }).maxRent).toBeUndefined()
  })
})

describe('buildQuery', () => {
  it('round-trips every filter the UI writes, including a studio', () => {
    const filters = {
      search: 'Green St',
      companies: ['jsm', 'roland-realty'],
      neighborhoods: ['Campustown'],
      maxRent: 1200,
      bedrooms: [0, 1],
      sort: 'price' as const,
    }
    expect(parseFilters(Object.fromEntries(new URLSearchParams(buildQuery(filters))))).toEqual(filters)
  })

  it('omits defaults and empties', () => {
    expect(buildQuery({ sort: 'rating', companies: [] })).toBe('')
  })
})

describe('hasActiveFilters', () => {
  it('counts a studio-only bedroom filter as active', () => {
    expect(hasActiveFilters({ bedrooms: [0] })).toBe(true)
  })
})
