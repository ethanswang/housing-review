import type { Database } from '../db.ts'
import { type Averages, type Page, escapeLike, toNumber, toPage, totalForPage } from './shared.ts'

/**
 * Every property read lives here. Routes never build SQL, and nothing outside
 * this file knows the shape of the database. Values always reach Postgres as
 * bound parameters; the only thing ever interpolated is a sort clause chosen
 * from the whitelist below.
 */

export type SortKey = 'rating' | 'price' | 'reviews'

export type PropertyQuery = {
  search?: string
  companies?: string[]
  neighborhoods?: string[]
  maxRent?: number
  bedrooms?: number[]
  sort: SortKey
  page: number
  perPage: number
}

export type PropertySummary = {
  id: string
  slug: string
  name: string
  address: string
  /** Null when unknown, as for buildings imported from public data. */
  neighborhood: string | null
  rentMin: number | null
  rentMax: number | null
  bedrooms: number[]
  /** From public building data; null when not known. */
  unitCount: number | null
  stories: number | null
  /** The building's own leasing site, entered by hand; null when not known. */
  website: string | null
  company: { slug: string; name: string } | null
  reviewCount: number
  averages: Averages
}

export type Review = {
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

/**
 * A sort key never reaches SQL as text from the request. It selects one of
 * these clauses, each ending in `slug` so that ordering is total: without a
 * unique tiebreaker, rows with equal ratings can appear on two pages or on
 * none as the planner reshuffles equal keys between queries.
 */
// Ties, such as every unreviewed building under `rating`, go largest first:
// with few reviews, that puts the buildings most students live in at the top
// rather than small ones that happen to sort first by address.
const SORT_CLAUSES: Record<SortKey, string> = {
  rating: 'avg_overall desc nulls last, unit_count desc nulls last, slug asc',
  price: 'rent_min asc nulls last, unit_count desc nulls last, slug asc',
  reviews: 'review_count desc, unit_count desc nulls last, slug asc',
}

type PropertyStatsRow = {
  id: string
  slug: string
  name: string
  address: string
  neighborhood: string | null
  rent_min: number | null
  rent_max: number | null
  bedrooms: number[]
  unit_count: number | null
  stories: number | null
  website: string | null
  company_slug: string | null
  company_name: string | null
  review_count: number
  avg_overall: string | null
  avg_maintenance: string | null
  avg_communication: string | null
  avg_value: string | null
}

export function toSummary(row: PropertyStatsRow): PropertySummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    address: row.address,
    neighborhood: row.neighborhood,
    rentMin: row.rent_min,
    rentMax: row.rent_max,
    bedrooms: row.bedrooms,
    unitCount: row.unit_count,
    stories: row.stories,
    website: row.website,
    company:
      row.company_slug && row.company_name
        ? { slug: row.company_slug, name: row.company_name }
        : null,
    reviewCount: row.review_count,
    averages: {
      overall: toNumber(row.avg_overall),
      maintenance: toNumber(row.avg_maintenance),
      communication: toNumber(row.avg_communication),
      value: toNumber(row.avg_value),
    },
  }
}

export async function listProperties(
  db: Database,
  query: PropertyQuery
): Promise<Page<PropertySummary>> {
  // Browsing shows listed buildings; a search also finds houses and buildings
  // of unknown type. Hidden ones (Greek houses, for now) only by their own page.
  const conditions: string[] = [query.search ? `visibility in ('listed', 'search_only')` : `visibility = 'listed'`]
  const filterParams: unknown[] = []

  if (query.search) {
    filterParams.push(`%${escapeLike(query.search)}%`)
    conditions.push(`(name ilike $${filterParams.length} or address ilike $${filterParams.length})`)
  }
  if (query.companies?.length) {
    filterParams.push(query.companies)
    conditions.push(`company_slug = any($${filterParams.length}::text[])`)
  }
  if (query.neighborhoods?.length) {
    filterParams.push(query.neighborhoods)
    conditions.push(`neighborhood = any($${filterParams.length}::text[])`)
  }
  if (query.maxRent !== undefined) {
    // Matches when the cheapest unit is within budget, not the most expensive.
    filterParams.push(query.maxRent)
    conditions.push(`rent_min <= $${filterParams.length}`)
  }
  if (query.bedrooms?.length) {
    // Overlap: the property offers at least one of the requested sizes.
    filterParams.push(query.bedrooms)
    conditions.push(`bedrooms && $${filterParams.length}::int[]`)
  }

  const where = `where ${conditions.join(' and ')}`
  const offset = (query.page - 1) * query.perPage
  const params = [...filterParams, query.perPage, offset]

  // count(*) over() returns the total for the filter in the same round trip,
  // so paging does not cost a second query that could disagree with the first.
  const { rows } = await db.query(
    `select *, count(*) over() as total_count
     from property_stats
     ${where}
     order by ${SORT_CLAUSES[query.sort]}
     limit $${params.length - 1} offset $${params.length}`,
    params
  )

  // Counted against the base tables rather than property_stats: every filter the
  // WHERE can reference is available from this join, and counting through the
  // view would run the per-property review aggregate for every matching row
  // only to discard it.
  const total = await totalForPage(rows, query.page, async () => {
    const { rows: counted } = await db.query(
      `select count(*)::int as total from (
         select p.name, p.address, p.neighborhood, p.rent_min, p.bedrooms, p.visibility,
                c.slug as company_slug
         from properties p
         left join management_companies c on c.id = p.company_id
       ) as filtered ${where}`,
      filterParams
    )
    return counted[0].total
  })

  return toPage(rows.map(toSummary), query.page, query.perPage, total)
}

export async function getPropertyBySlug(
  db: Database,
  slug: string
): Promise<PropertySummary | null> {
  const { rows } = await db.query('select * from property_stats where slug = $1', [slug])
  return rows.length ? toSummary(rows[0] as PropertyStatsRow) : null
}

export async function listReviewsForProperty(
  db: Database,
  propertyId: string,
  page: number,
  perPage: number
): Promise<Page<Review>> {
  const { rows } = await db.query(
    `select id, maintenance, communication, value, overall, body, lease_term,
            is_sample, created_at, count(*) over() as total_count
     from reviews
     where property_id = $1 and status = 'published'
     order by created_at desc, id asc
     limit $2 offset $3`,
    [propertyId, perPage, (page - 1) * perPage]
  )

  const total = await totalForPage(rows, page, async () => {
    const { rows: counted } = await db.query(
      `select count(*)::int as total from reviews where property_id = $1 and status = 'published'`,
      [propertyId]
    )
    return counted[0].total
  })

  return toPage(
    rows.map((row) => ({
      id: row.id,
      maintenance: row.maintenance,
      communication: row.communication,
      value: row.value,
      overall: row.overall,
      body: row.body,
      leaseTerm: row.lease_term,
      isSample: row.is_sample,
      createdAt: row.created_at.toISOString(),
    })),
    page,
    perPage,
    total
  )
}

export type FilterOptions = {
  companies: { slug: string; name: string }[]
  neighborhoods: string[]
  bedrooms: number[]
  maxRent: number
}

/** What the directory's filters offer, drawn from the data rather than hard-coded. */
export async function getFilterOptions(db: Database): Promise<FilterOptions> {
  const [companies, options] = await Promise.all([
    db.query('select slug, name from management_companies order by name, slug'),
    db.query(
      `select
         coalesce((select array_agg(distinct neighborhood order by neighborhood) filter (where neighborhood is not null) from properties), '{}') as neighborhoods,
         coalesce((select array_agg(distinct b order by b) from properties, unnest(bedrooms) as b), '{}') as bedrooms,
         coalesce((select max(rent_max) from properties), 0) as max_rent`
    ),
  ])
  const row = options.rows[0]
  return {
    companies: companies.rows,
    neighborhoods: row.neighborhoods,
    bedrooms: row.bedrooms,
    maxRent: row.max_rent,
  }
}
