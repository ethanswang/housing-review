import pg from 'pg'
import type { Client } from 'pg'

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://housing:housing_dev@localhost:5433/housing'

/**
 * Every test runs inside a transaction that is rolled back afterwards, so tests
 * share one database without seeing each other's rows and without truncating
 * between cases.
 */
export async function connect(): Promise<Client> {
  const client = new pg.Client({ connectionString: DATABASE_URL })
  await client.connect()
  const { rows } = await client.query(
    `select to_regclass('public.reviews') is not null as ready`
  )
  if (!rows[0].ready) {
    await client.end()
    throw new Error('Schema missing. Run: docker compose up -d --wait db && npm run db:migrate && npm run db:seed')
  }
  return client
}

export async function insertUser(
  client: Client,
  email = `student-${crypto.randomUUID()}@illinois.edu`,
  role = 'student'
): Promise<string> {
  const { rows } = await client.query(
    `insert into users (id, email, role) values (gen_random_uuid(), $1, $2) returning id`,
    [email, role]
  )
  return rows[0].id
}

export async function insertProperty(client: Client, companyId: string | null = null): Promise<string> {
  const slug = `prop-${crypto.randomUUID()}`
  const { rows } = await client.query(
    `insert into properties (company_id, name, slug, address, neighborhood, rent_min, rent_max, bedrooms)
     values ($1, 'Test Property', $2, '100 block of Test St', 'Campustown', 700, 1200, '{1,2}')
     returning id`,
    [companyId, slug]
  )
  return rows[0].id
}

export async function insertCompany(client: Client): Promise<string> {
  const slug = `co-${crypto.randomUUID()}`
  const { rows } = await client.query(
    `insert into management_companies (name, slug) values ('Test Company', $1) returning id`,
    [slug]
  )
  return rows[0].id
}

export const VALID_BODY = 'This is a long enough review body to satisfy the length constraint.'

export async function insertReview(
  client: Client,
  propertyId: string,
  overrides: Record<string, unknown> = {}
) {
  const row = {
    maintenance: 4,
    communication: 4,
    value: 4,
    overall: 4,
    body: VALID_BODY,
    lease_term: '2024-25',
    author_id: null,
    status: 'published',
    is_sample: false,
    ...overrides,
  }
  const { rows } = await client.query(
    `insert into reviews (property_id, author_id, maintenance, communication, value, overall,
                          body, lease_term, status, is_sample)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [
      propertyId, row.author_id, row.maintenance, row.communication, row.value,
      row.overall, row.body, row.lease_term, row.status, row.is_sample,
    ]
  )
  return rows[0].id
}
