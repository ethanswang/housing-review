import type { Database } from '../db.ts'
import { type PropertySummary, toSummary } from './properties.ts'
import { type Averages, type Page, toNumber, toPage, totalForPage } from './shared.ts'

export type CompanySortKey = 'rating' | 'name' | 'properties' | 'reviews'

export type CompanySummary = {
  id: string
  slug: string
  name: string
  website: string | null
  propertyCount: number
  reviewCount: number
  averages: Averages
}

export type CompanyDetail = CompanySummary & {
  properties: Page<PropertySummary>
}

/**
 * Chosen from this map, never interpolated from the request. Each clause ends
 * in `slug` so the ordering is total and pages cannot overlap or skip.
 */
const SORT_CLAUSES: Record<CompanySortKey, string> = {
  rating: 'avg_overall desc nulls last, slug asc',
  name: 'name asc, slug asc',
  properties: 'property_count desc, slug asc',
  reviews: 'review_count desc, slug asc',
}

type CompanyStatsRow = {
  id: string
  slug: string
  name: string
  website: string | null
  property_count: number
  review_count: number
  avg_overall: string | null
  avg_maintenance: string | null
  avg_communication: string | null
  avg_value: string | null
}

function toCompany(row: CompanyStatsRow): CompanySummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    website: row.website,
    propertyCount: row.property_count,
    reviewCount: row.review_count,
    averages: {
      overall: toNumber(row.avg_overall),
      maintenance: toNumber(row.avg_maintenance),
      communication: toNumber(row.avg_communication),
      value: toNumber(row.avg_value),
    },
  }
}

export async function listCompanies(
  db: Database,
  query: { sort: CompanySortKey; page: number; perPage: number }
): Promise<Page<CompanySummary>> {
  const offset = (query.page - 1) * query.perPage
  const { rows } = await db.query(
    `select *, count(*) over() as total_count
     from company_stats
     order by ${SORT_CLAUSES[query.sort]}
     limit $1 offset $2`,
    [query.perPage, offset]
  )

  const total = await totalForPage(rows, query.page, async () => {
    const { rows: counted } = await db.query(
      'select count(*)::int as total from management_companies'
    )
    return counted[0].total
  })

  return toPage(rows.map(toCompany), query.page, query.perPage, total)
}

export async function getCompanyBySlug(
  db: Database,
  slug: string
): Promise<CompanySummary | null> {
  const { rows } = await db.query('select * from company_stats where slug = $1', [slug])
  return rows.length ? toCompany(rows[0] as CompanyStatsRow) : null
}

/** A company's buildings, highest rated first, paginated like every other list. */
export async function listCompanyProperties(
  db: Database,
  companyId: string,
  page: number,
  perPage: number
): Promise<Page<PropertySummary>> {
  const { rows } = await db.query(
    `select *, count(*) over() as total_count
     from property_stats
     where company_id = $1 and visibility <> 'hidden'
     order by avg_overall desc nulls last, slug asc
     limit $2 offset $3`,
    [companyId, perPage, (page - 1) * perPage]
  )

  const total = await totalForPage(rows, page, async () => {
    const { rows: counted } = await db.query(
      `select count(*)::int as total from properties where company_id = $1 and visibility <> 'hidden'`,
      [companyId]
    )
    return counted[0].total
  })

  return toPage(rows.map(toSummary), page, perPage, total)
}
