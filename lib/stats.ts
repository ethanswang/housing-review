/**
 * Pure calculations over reviews and properties: no database access, so they
 * can be tested directly (lib/stats.test.ts). lib/queries.ts calls them.
 */
import { RATING_KEYS, type Averages, type PropertyFilters, type PropertyWithStats } from './types'

export type RatingRow = { maintenance: number; communication: number; value: number; overall: number }

export function round1(n: number) {
  return Math.round(n * 10) / 10
}

/**
 * Mean of each rating category, or null for a category with no reviews.
 */
export function averageRatings(reviews: RatingRow[]): Averages {
  const averages = {} as Averages
  for (const key of RATING_KEYS) {
    averages[key] = reviews.length
      ? round1(reviews.reduce((sum, r) => sum + r[key], 0) / reviews.length)
      : null
  }
  return averages
}

/**
 * A company's score: every review of every one of its buildings, averaged
 * together. Weighting each building's rounded average by its review count
 * rounds twice and can differ from the API's company_stats by 0.1.
 */
export function companyAverages(buildings: { reviews: RatingRow[] }[]): Averages {
  return averageRatings(buildings.flatMap((building) => building.reviews))
}

/**
 * Sorting happens in JavaScript because two of the three sort keys (rating,
 * review count) are computed from the joined reviews. Every order ends in the
 * slug, as the API's does, so equal keys come back in the same order on every
 * request instead of whatever order the database returned them in.
 */
export function sortProperties(properties: PropertyWithStats[], sort: PropertyFilters['sort']) {
  // Code-point order, like SQL's `slug asc` under the C collation. localeCompare
  // would follow the server's locale, which can order letters differently.
  const bySlug = (a: PropertyWithStats, b: PropertyWithStats) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)
  const sorted = [...properties]
  if (sort === 'price') {
    sorted.sort((a, b) => a.rent_min - b.rent_min || bySlug(a, b))
  } else if (sort === 'reviews') {
    sorted.sort((a, b) => b.reviewCount - a.reviewCount || bySlug(a, b))
  } else {
    // Default: highest rated. Unreviewed properties sort last rather than first.
    sorted.sort((a, b) => (b.averages.overall ?? -1) - (a.averages.overall ?? -1) || bySlug(a, b))
  }
  return sorted
}
