import { describe, expect, it } from 'vitest'
import { buildQuery, hasActiveFilters, pageQuery, parseFilters, parsePage } from './filters'

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

describe('parsePage', () => {
  it('reads a positive whole page number, and falls back to 1', () => {
    expect(parsePage({ page: '3' })).toBe(3)
    for (const page of [undefined, '', '0', '-2', '1.5', 'abc', '99999999']) {
      expect(parsePage({ page })).toBe(1)
    }
  })
})

describe('pageQuery', () => {
  it('keeps the filters and adds the page, leaving page 1 implicit', () => {
    expect(pageQuery({ search: 'green', sort: 'price' }, 2)).toBe('q=green&sort=price&page=2')
    expect(pageQuery({ search: 'green' }, 1)).toBe('q=green')
  })

  it('is not part of the filters, so changing a filter starts from page 1', () => {
    expect(buildQuery(parseFilters({ q: 'green', page: '4' }))).toBe('q=green')
  })
})

describe('parseFilters maxRent', () => {
  it('takes whole dollars up to the API limit, and ignores anything else rather than failing the page', () => {
    expect(parseFilters({ maxRent: '1500' }).maxRent).toBe(1500)
    for (const maxRent of ['1500.5', '999999', '0', '-5', 'abc']) {
      expect(parseFilters({ maxRent }).maxRent).toBeUndefined()
    }
  })
})

