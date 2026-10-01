/**
 * The single translation layer between the URL and the database.
 *
 * Filter state lives in the query string (not React state) so that every view
 * is shareable, bookmarkable, and survives back/forward. The server page parses
 * it with `parseFilters`; the client rail writes it with `buildQuery`.
 */
import type { PropertyFilters, SortKey } from './types'

export type RawSearchParams = Record<string, string | string[] | undefined>

const SORT_KEYS: SortKey[] = ['rating', 'price', 'reviews']

/**
 * How long the rent slider waits after it stops moving before it applies.
 * Shared with the end-to-end tests, which time their "nothing else happens"
 * checks from it.
 */
export const RENT_SLIDER_PAUSE_MS = 300

function one(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value
  return v?.trim() || undefined
}

/** Multi-value params are comma-separated: ?company=jsm,bankier-apartments */
function list(value: string | string[] | undefined): string[] | undefined {
  const v = one(value)
  if (!v) return undefined
  const items = v.split(',').map((s) => s.trim()).filter(Boolean)
  return items.length ? items : undefined
}

/** Search text the database can use: no control characters, at most 100 characters, like the API. */
function searchText(value: string | string[] | undefined): string | undefined {
  const text = one(value)?.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 100).trim()
  return text || undefined
}

export function parseFilters(params: RawSearchParams): PropertyFilters {
  const maxRent = Number(one(params.maxRent))
  const sort = one(params.sort) as SortKey | undefined

  return {
    search: searchText(params.q),
    companies: list(params.company),
    neighborhoods: list(params.hood),
    maxRent: Number.isFinite(maxRent) && maxRent > 0 ? maxRent : undefined,
    bedrooms: list(params.beds)
      ?.map(Number)
      // 0 is a studio. Capped at 20, as the API caps it: a huge number would
      // reach Postgres as an out-of-range integer and fail the whole page.
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 20),
    sort: sort && SORT_KEYS.includes(sort) ? sort : 'rating',
  }
}

/** Serialize filters back into a query string, omitting defaults and empties. */
export function buildQuery(filters: PropertyFilters): string {
  const params = new URLSearchParams()
  if (filters.search) params.set('q', filters.search)
  if (filters.companies?.length) params.set('company', filters.companies.join(','))
  if (filters.neighborhoods?.length) params.set('hood', filters.neighborhoods.join(','))
  if (filters.maxRent) params.set('maxRent', String(filters.maxRent))
  if (filters.bedrooms?.length) params.set('beds', filters.bedrooms.join(','))
  if (filters.sort && filters.sort !== 'rating') params.set('sort', filters.sort)
  return params.toString()
}

export function hasActiveFilters(filters: PropertyFilters): boolean {
  return Boolean(
    filters.search ||
      filters.companies?.length ||
      filters.neighborhoods?.length ||
      filters.maxRent ||
      filters.bedrooms?.length
  )
}
