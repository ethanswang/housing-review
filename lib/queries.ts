/**
 * Every database read and write in the app happens in this file.
 *
 *   Browser → Next.js page / Server Action → queries.ts → Supabase client → Postgres
 *
 * Pages never import the Supabase client directly. Keeping data access in one
 * place means the filter logic is reviewable in a single sitting, and the
 * storage layer can be swapped without touching a single component.
 */
import { supabase } from './supabase'
import {
  RATING_KEYS,
  type Averages,
  type Company,
  type CompanyWithStats,
  type PropertyDetail,
  type PropertyFilters,
  type PropertyWithStats,
  type Review,
} from './types'

/** Shape Supabase returns for a property row with its company and ratings joined in. */
type PropertyRow = {
  id: string
  name: string
  slug: string
  address: string
  neighborhood: string
  rent_min: number
  rent_max: number
  bedrooms: number[]
  company_id: string | null
  company: Company | null
  reviews: { maintenance: number; communication: number; value: number; overall: number }[]
}

const PROPERTY_SELECT = `
  id, name, slug, address, neighborhood, rent_min, rent_max, bedrooms, company_id,
  company:management_companies (id, name, slug),
  reviews (maintenance, communication, value, overall)
`

function round1(n: number) {
  return Math.round(n * 10) / 10
}

/** Mean of each rating category, or null for a category with no reviews. */
function averageRatings(reviews: PropertyRow['reviews']): Averages {
  const averages = {} as Averages
  for (const key of RATING_KEYS) {
    averages[key] = reviews.length
      ? round1(reviews.reduce((sum, r) => sum + r[key], 0) / reviews.length)
      : null
  }
  return averages
}

function toPropertyWithStats(row: PropertyRow): PropertyWithStats {
  const { reviews, ...property } = row
  return { ...property, averages: averageRatings(reviews), reviewCount: reviews.length }
}

/**
 * Sorting happens here rather than in SQL because two of the three sort keys
 * (rating, review count) are computed from the joined reviews. With a dataset
 * this size the difference is unmeasurable; when it stops being small, these
 * become materialized columns or a view.
 */
function sortProperties(properties: PropertyWithStats[], sort: PropertyFilters['sort']) {
  const sorted = [...properties]
  if (sort === 'price') {
    sorted.sort((a, b) => a.rent_min - b.rent_min)
  } else if (sort === 'reviews') {
    sorted.sort((a, b) => b.reviewCount - a.reviewCount)
  } else {
    // Default: highest rated. Unreviewed properties sort last rather than first.
    sorted.sort((a, b) => (b.averages.overall ?? -1) - (a.averages.overall ?? -1))
  }
  return sorted
}

/**
 * The directory query. Each filter below maps to exactly one clause, which is
 * what makes "how does a URL param become a database condition" answerable.
 */
export async function listProperties(filters: PropertyFilters = {}): Promise<PropertyWithStats[]> {
  let query = supabase.from('properties').select(PROPERTY_SELECT)

  if (filters.search) {
    // Escape the PostgREST `or` delimiters so a comma in the query can't inject a filter.
    const term = filters.search.replace(/[,()]/g, ' ').trim()
    if (term) query = query.or(`name.ilike.%${term}%,address.ilike.%${term}%`)
  }
  if (filters.neighborhoods?.length) {
    query = query.in('neighborhood', filters.neighborhoods)
  }
  if (filters.maxRent) {
    // Match if the cheapest unit is within budget, not the most expensive.
    query = query.lte('rent_min', filters.maxRent)
  }
  if (filters.bedrooms?.length) {
    // `overlaps` = the property offers at least one of the requested sizes.
    query = query.overlaps('bedrooms', filters.bedrooms)
  }

  const { data, error } = await query
  if (error) throw new Error(`Failed to load properties: ${error.message}`)

  let properties = (data as unknown as PropertyRow[]).map(toPropertyWithStats)

  // Company is filtered here because it lives on the joined table; filtering a
  // joined column server-side would turn the join into an inner join and drop
  // properties whose company row is missing.
  if (filters.companies?.length) {
    properties = properties.filter((p) => p.company && filters.companies!.includes(p.company.slug))
  }

  return sortProperties(properties, filters.sort)
}

export async function getPropertyBySlug(slug: string): Promise<PropertyDetail | null> {
  const { data, error } = await supabase
    .from('properties')
    .select(PROPERTY_SELECT)
    .eq('slug', slug)
    .maybeSingle()

  if (error) throw new Error(`Failed to load property: ${error.message}`)
  if (!data) return null

  const property = toPropertyWithStats(data as unknown as PropertyRow)

  const { data: reviews, error: reviewsError } = await supabase
    .from('reviews')
    .select('*')
    .eq('property_id', property.id)
    .order('created_at', { ascending: false })

  if (reviewsError) throw new Error(`Failed to load reviews: ${reviewsError.message}`)

  return { ...property, reviews: (reviews ?? []) as Review[] }
}

export async function getCompanyBySlug(slug: string): Promise<CompanyWithStats | null> {
  const { data: company, error } = await supabase
    .from('management_companies')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle()

  if (error) throw new Error(`Failed to load company: ${error.message}`)
  if (!company) return null

  const { data, error: propertiesError } = await supabase
    .from('properties')
    .select(PROPERTY_SELECT)
    .eq('company_id', company.id)

  if (propertiesError) throw new Error(`Failed to load company properties: ${propertiesError.message}`)

  const properties = sortProperties(
    (data as unknown as PropertyRow[]).map(toPropertyWithStats),
    'rating'
  )

  /**
   * A company's score is the mean of its properties' scores, weighted by review
   * count so a heavily-reviewed building counts for more than a barely-reviewed
   * one. Only properties that actually have reviews contribute.
   *
   * Known limitation, documented in the README roadmap: management experience is
   * not always property-specific. Lease terms, deposits and billing are
   * company-level concerns that a derived average cannot capture. A later
   * version likely wants first-class management-company reviews.
   */
  const averages = {} as Averages
  for (const key of RATING_KEYS) {
    const scored = properties.filter((p) => p.averages[key] !== null)
    const weight = scored.reduce((sum, p) => sum + p.reviewCount, 0)
    averages[key] = weight
      ? round1(scored.reduce((sum, p) => sum + p.averages[key]! * p.reviewCount, 0) / weight)
      : null
  }

  return {
    ...company,
    properties,
    averages,
    reviewCount: properties.reduce((sum, p) => sum + p.reviewCount, 0),
  }
}

/** Filter-rail options. Companies come from the table; neighborhoods are derived. */
export async function getFilterOptions() {
  const [companiesResult, propertiesResult] = await Promise.all([
    supabase.from('management_companies').select('id, name, slug').order('name'),
    supabase.from('properties').select('neighborhood, bedrooms, rent_max'),
  ])

  if (companiesResult.error) throw new Error(`Failed to load companies: ${companiesResult.error.message}`)
  if (propertiesResult.error) throw new Error(`Failed to load filter options: ${propertiesResult.error.message}`)

  const rows = propertiesResult.data ?? []
  return {
    companies: (companiesResult.data ?? []) as Company[],
    neighborhoods: [...new Set(rows.map((r) => r.neighborhood))].sort(),
    bedrooms: [...new Set(rows.flatMap((r) => r.bedrooms as number[]))].sort((a, b) => a - b),
    maxRent: rows.reduce((max, r) => Math.max(max, r.rent_max as number), 0),
  }
}

export type NewReview = {
  property_id: string
  maintenance: number
  communication: number
  value: number
  overall: number
  body: string
  lease_term: string
}

/**
 * Sends only the review's own fields. The anon role may insert exactly these
 * columns (supabase/schema.sql), so `is_sample`, `id` and `created_at` take
 * their defaults and cannot be set by a caller — not even this one.
 */
export async function insertReview(review: NewReview) {
  const { error } = await supabase.from('reviews').insert(review)
  if (error) throw new Error(`Failed to save review: ${error.message}`)
}
