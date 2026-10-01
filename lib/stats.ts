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
 *
 * A company's score is this over all its buildings' reviews together — not an
 * average of each building's already-rounded average, which rounds twice and
 * can land 0.1 away from the API's company_stats for the same reviews.
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
 * Sorting happens in JavaScript because two of the three sort keys (rating,
 * review count) are computed from the joined reviews. Every order ends in the
 * slug, as the API's does, so equal keys come back in the same order on every
 * request instead of whatever order the database returned them in.
 */
export function sortProperties(properties: PropertyWithStats[], sort: PropertyFilters['sort']) {
  const bySlug = (a: PropertyWithStats, b: PropertyWithStats) => a.slug.localeCompare(b.slug)
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
