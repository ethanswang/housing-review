/**
 * Every read and write the site makes goes through this file.
 *
 *   Browser → Next.js page / Server Action → queries.ts → the API → Postgres
 *
 * Pages never call the API directly. The API returns camelCase
 * records; this file maps them to the types in lib/types.ts, so components do
 * not depend on the API's field names.
 */
import 'server-only'
import { headers } from 'next/headers'
import type {
  Averages,
  CompanyWithStats,
  PropertyDetail,
  PropertyFilters,
  PropertyWithStats,
  Review,
} from './types'

const API_URL = process.env.API_URL ?? 'http://localhost:3001'
// Shared with the API. With it, the API rate-limits each visitor by their own
// address rather than this server's (docs/API.md).
const FRONTEND_SECRET = process.env.FRONTEND_SECRET

type ApiProperty = {
  id: string
  slug: string
  name: string
  address: string
  neighborhood: string | null
  rentMin: number | null
  rentMax: number | null
  unitCount: number | null
  stories: number | null
  website: string | null
  bedrooms: number[]
  company: { slug: string; name: string } | null
  reviewCount: number
  averages: Averages
}
type ApiReview = {
  id: string
  maintenance: number
  communication: number
  value: number
  overall: number
  body: string
  leaseTerm: string
  isSample: boolean
  createdAt: string
}
type Page<T> = { data: T[]; page: number; totalPages: number; total: number }

/** GET from the API. null for a 404; any other failure throws, for app/error.tsx. */
async function visitorHeaders(): Promise<Record<string, string>> {
  const request = await headers()
  const visitor = request.get('x-real-ip') ?? request.get('x-forwarded-for')?.split(',')[0]?.trim()
  return FRONTEND_SECRET && visitor ? { 'x-frontend-secret': FRONTEND_SECRET, 'x-client-ip': visitor } : {}
}

async function get<T>(path: string): Promise<T | null> {
  const response = await fetch(`${API_URL}${path}`, { cache: 'no-store', headers: await visitorHeaders() })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`API GET ${path} answered ${response.status}`)
  return response.json() as Promise<T>
}

const toProperty = (p: ApiProperty): PropertyWithStats => ({
  id: p.id,
  slug: p.slug,
  name: p.name,
  address: p.address,
  neighborhood: p.neighborhood,
  rent_min: p.rentMin,
  rent_max: p.rentMax,
  unit_count: p.unitCount,
  stories: p.stories,
  // An API from before websites existed sends none.
  website: p.website ?? null,
  bedrooms: p.bedrooms,
  company: p.company,
  averages: p.averages,
  reviewCount: p.reviewCount,
})

const toReview = (r: ApiReview): Review => ({
  id: r.id,
  maintenance: r.maintenance,
  communication: r.communication,
  value: r.value,
  overall: r.overall,
  body: r.body,
  lease_term: r.leaseTerm,
  is_sample: r.isSample,
  created_at: r.createdAt,
})

/**
 * The directory. Filtering, sorting and search all happen in the API's SQL;
 * this asks for every page, since the directory shows the whole list.
 */
/** One page of the directory, with the total for the whole filter. */
export async function listProperties(
  filters: PropertyFilters = {},
  page = 1,
  perPage = 24
): Promise<{ properties: PropertyWithStats[]; total: number; totalPages: number }> {
  const params = new URLSearchParams({ page: String(page), perPage: String(perPage), sort: filters.sort ?? 'rating' })
  if (filters.search) params.set('q', filters.search)
  if (filters.companies?.length) params.set('company', filters.companies.join(','))
  if (filters.neighborhoods?.length) params.set('hood', filters.neighborhoods.join(','))
  if (filters.bedrooms?.length) params.set('beds', filters.bedrooms.join(','))
  if (filters.maxRent) params.set('maxRent', String(filters.maxRent))

  const result = await get<Page<ApiProperty>>(`/api/properties?${params}`)
  if (!result) throw new Error('API has no /api/properties')
  return { properties: result.data.map(toProperty), total: result.total, totalPages: result.totalPages }
}

export async function getPropertyBySlug(slug: string): Promise<PropertyDetail | null> {
  const result = await get<ApiProperty & { reviews: Page<ApiReview> }>(
    `/api/properties/${encodeURIComponent(slug)}?perPage=100`
  )
  return result && { ...toProperty(result), reviews: result.reviews.data.map(toReview) }
}

export async function getCompanyBySlug(slug: string): Promise<CompanyWithStats | null> {
  const result = await get<{
    slug: string
    name: string
    reviewCount: number
    averages: Averages
    properties: Page<ApiProperty>
  }>(`/api/companies/${encodeURIComponent(slug)}?perPage=100`)
  return (
    result && {
      slug: result.slug,
      name: result.name,
      averages: result.averages,
      reviewCount: result.reviewCount,
      properties: result.properties.data.map(toProperty),
    }
  )
}

export async function getFilterOptions() {
  const result = await get<{
    companies: { slug: string; name: string }[]
    neighborhoods: string[]
    bedrooms: number[]
    maxRent: number
  }>('/api/filters')
  if (!result) throw new Error('API has no /api/filters')
  return result
}

export type NewReview = {
  maintenance: number
  communication: number
  value: number
  overall: number
  body: string
  lease_term: string
}

/**
 * The signed-in student's own review of this building, if they have one that
 * stops them posting another: published, or hidden by a moderator. A withdrawn
 * review does not count, as the API lets its author post again.
 *
 * Null as well when the API cannot say (an expired token, an outage): the page
 * then shows the form, and the API still refuses a second review.
 */
export async function getMyReview(
  slug: string,
  accessToken: string
): Promise<{ status: 'published' | 'hidden' } | null> {
  try {
    const response = await fetch(`${API_URL}/api/me/reviews`, {
      cache: 'no-store',
      headers: { ...(await visitorHeaders()), authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) {
      if (response.status !== 401) console.error('getMyReview: the API answered', response.status)
      return null
    }
    const reviews = (await response.json()) as { propertySlug: string; status: string }[]
    const mine = reviews.find((r) => r.propertySlug === slug && (r.status === 'published' || r.status === 'hidden'))
    return mine ? { status: mine.status as 'published' | 'hidden' } : null
  } catch (error) {
    console.error('getMyReview failed', error)
    return null
  }
}

/**
 * Posts a review as the signed-in student whose access token this is; the API
 * verifies the token and decides who the author is. Returns the API's error
 * code on failure, such as `already_reviewed`, for the form to explain.
 */
export async function postReview(
  slug: string,
  review: NewReview,
  accessToken: string
): Promise<{ ok: true } | { ok: false; status: number; code?: string }> {
  const { lease_term, ...rest } = review
  const response = await fetch(`${API_URL}/api/properties/${encodeURIComponent(slug)}/reviews`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      ...(await visitorHeaders()),
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ...rest, leaseTerm: lease_term }),
  })
  if (response.ok) return { ok: true }
  const code = await response
    .json()
    .then((body: { error?: { code?: string } }) => body.error?.code)
    .catch(() => undefined)
  return { ok: false, status: response.status, code }
}
