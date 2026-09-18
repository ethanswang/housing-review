import type { Database } from '../db.ts'

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

export type Averages = {
  overall: number | null
  maintenance: number | null
  communication: number | null
  value: number | null
}

export type PropertySummary = {
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

export type Page<T> = {
  data: T[]
  page: number
  perPage: number
  total: number
  totalPages: number
}

/**
 * A sort key never reaches SQL as text from the request. It selects one of
 * these clauses, each ending in `slug` so that ordering is total: without a
 * unique tiebreaker, rows with equal ratings can appear on two pages or on
 * none as the planner reshuffles equal keys between queries.
 */
const SORT_CLAUSES: Record<SortKey, string> = {
  rating: 'avg_overall desc nulls last, slug asc',
  price: 'rent_min asc, slug asc',
  reviews: 'review_count desc, slug asc',
}

/**
 * `%` and `_` are wildcards to LIKE. Left unescaped, a search for "%" matches
 * every property and scans the whole table, and "_" quietly matches any single
 * character. Values are bound parameters either way, so this is about correct
 * search behaviour, not injection.
 */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (match) => `\\${match}`)

/** node-postgres returns numeric as a string to avoid precision loss. */
const toNumber = (value: string | number | null): number | null =>
  value === null ? null : Number(value)

type PropertyStatsRow = {
  id: string
  slug: string
  name: string
  address: string
  neighborhood: string
  rent_min: number
  rent_max: number
  bedrooms: number[]
  company_slug: string | null
  company_name: string | null
  review_count: number
  avg_overall: string | null
  avg_maintenance: string | null
  avg_communication: string | null
  avg_value: string | null
}

function toSummary(row: PropertyStatsRow): PropertySummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    address: row.address,
    neighborhood: row.neighborhood,
    rentMin: row.rent_min,
    rentMax: row.rent_max,
    bedrooms: row.bedrooms,
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
  const conditions: string[] = []
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

  const where = conditions.length ? `where ${conditions.join(' and ')}` : ''
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

  // count(*) over() only reports a total when rows come back. Asking for a
  // page past the end would otherwise answer "total: 0", telling the client
  // the filter matches nothing when it matches plenty. The extra query runs
  // only on that empty-page path, so the normal case stays one round trip.
  let total = rows.length ? Number(rows[0].total_count) : 0
  if (!rows.length && query.page > 1) {
    // Counted against the base tables rather than property_stats: every filter
    // the WHERE can reference is available from this join, and counting through
    // the view would run the per-property review aggregate for every matching
    // row only to discard it.
    const { rows: counted } = await db.query(
      `select count(*)::int as total from (
         select p.name, p.address, p.neighborhood, p.rent_min, p.bedrooms,
                c.slug as company_slug
         from properties p
         left join management_companies c on c.id = p.company_id
       ) as filtered ${where}`,
      filterParams
    )
    total = counted[0].total
  }

  return {
    data: rows.map(toSummary),
    page: query.page,
    perPage: query.perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.perPage)),
  }
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

  let total = rows.length ? Number(rows[0].total_count) : 0
  if (!rows.length && page > 1) {
    const { rows: counted } = await db.query(
      `select count(*)::int as total from reviews where property_id = $1 and status = 'published'`,
      [propertyId]
    )
    total = counted[0].total
  }

  return {
    data: rows.map((row) => ({
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
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  }
}
