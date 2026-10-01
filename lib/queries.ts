/**
 * Every read and write the site makes goes through this file.
 *
 *   Browser → Next.js page / Server Action → queries.ts → the API → Postgres
 *
 * Pages never call the API or Supabase directly. The API returns camelCase
 * records; this file maps them to the types in lib/types.ts, so components do
 * not depend on the API's field names.
 */
import 'server-only'
import { headers } from 'next/headers'
import { supabase } from './supabase'
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
  neighborhood: string
  rentMin: number
  rentMax: number
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
type Page<T> = { data: T[]; page: number; totalPages: number }

/** GET from the API. null for a 404; any other failure throws, for app/error.tsx. */
async function get<T>(path: string): Promise<T | null> {
  const request = await headers()
  const visitor = request.get('x-real-ip') ?? request.get('x-forwarded-for')?.split(',')[0]?.trim()
  const response = await fetch(`${API_URL}${path}`, {
    cache: 'no-store',
    headers: FRONTEND_SECRET && visitor ? { 'x-frontend-secret': FRONTEND_SECRET, 'x-client-ip': visitor } : {},
  })
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
export async function listProperties(filters: PropertyFilters = {}): Promise<PropertyWithStats[]> {
  const params = new URLSearchParams({ perPage: '100', sort: filters.sort ?? 'rating' })
  if (filters.search) params.set('q', filters.search)
  if (filters.companies?.length) params.set('company', filters.companies.join(','))
  if (filters.neighborhoods?.length) params.set('hood', filters.neighborhoods.join(','))
  if (filters.bedrooms?.length) params.set('beds', filters.bedrooms.join(','))
  if (filters.maxRent) params.set('maxRent', String(filters.maxRent))

  const properties: PropertyWithStats[] = []
  for (let page = 1; ; page++) {
    params.set('page', String(page))
    const result = await get<Page<ApiProperty>>(`/api/properties?${params}`)
    if (!result) break
    properties.push(...result.data.map(toProperty))
    if (page >= result.totalPages) break
  }
  return properties
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
