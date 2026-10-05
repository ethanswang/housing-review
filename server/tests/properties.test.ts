import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { createPool, type Database } from '../src/db.ts'
import { DATABASE_URL } from './helpers.ts'

/**
 * Read-only integration tests against the development seed. They never write,
 * so they need no transaction and cannot disturb the schema tests.
 */
const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL,
  LOG_LEVEL: 'silent',
  SUPABASE_URL: 'https://project.supabase.co',
  // Pinned high so these suites can never trip the limiter incidentally; the
  // limiter's own behaviour is tested in rate-limit.test.ts with tiny ceilings.
  RATE_LIMIT_MAX: '100000',
  RATE_LIMIT_WRITE_MAX: '100000',
})

let app: FastifyInstance
let pool: Database

const get = (url: string) => app.inject({ method: 'GET', url })

beforeAll(async () => {
  pool = createPool(DATABASE_URL)
  app = await buildApp({ config, db: pool })
  await app.ready()
  const { rows } = await pool.query('select count(*)::int as n from properties')
  if (rows[0].n === 0) {
    throw new Error('No seed data. Run: npm run db:migrate && npm run db:seed')
  }
})

afterAll(async () => {
  await app?.close()
  await pool?.end()
})

describe('GET /api/properties', () => {
  it('returns every seeded property in a pagination envelope', async () => {
    const response = await get('/api/properties')
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.total).toBe(8)
    expect(body.data).toHaveLength(8)
    expect(body.page).toBe(1)
    expect(body.perPage).toBe(24)
    expect(body.totalPages).toBe(1)
  })

  it('pages without dropping or repeating rows', async () => {
    const first = (await get('/api/properties?perPage=3&page=1')).json()
    const second = (await get('/api/properties?perPage=3&page=2')).json()
    const third = (await get('/api/properties?perPage=3&page=3')).json()
    expect([first.data.length, second.data.length, third.data.length]).toEqual([3, 3, 2])
    expect(first.totalPages).toBe(3)
    const slugs = [...first.data, ...second.data, ...third.data].map((p: { slug: string }) => p.slug)
    expect(new Set(slugs).size).toBe(8)
  })

  it('searches name and address', async () => {
    const byName = (await get('/api/properties?q=bankier')).json()
    expect(byName.data.map((p: { slug: string }) => p.slug)).toEqual(['bankier-apartments'])
    const byAddress = (await get('/api/properties?q=Urbana')).json()
    expect(byAddress.data.map((p: { slug: string }) => p.slug)).toEqual(['smith-apartments'])
  })

  it('filters by management company', async () => {
    const body = (await get('/api/properties?company=jsm')).json()
    expect(body.total).toBe(2)
    expect(body.data.every((p: { company: { slug: string } }) => p.company.slug === 'jsm')).toBe(true)
  })

  it('filters by neighbourhood', async () => {
    const body = (await get('/api/properties?hood=Urbana')).json()
    expect(body.data.map((p: { slug: string }) => p.slug)).toEqual(['smith-apartments'])
  })

  it('filters by maximum rent against the cheapest unit', async () => {
    const body = (await get('/api/properties?maxRent=700')).json()
    expect(body.total).toBe(4)
    expect(body.data.every((p: { rentMin: number }) => p.rentMin <= 700)).toBe(true)
  })

  it('filters by bedroom count using array overlap', async () => {
    const body = (await get('/api/properties?beds=4')).json()
    expect(body.total).toBe(4)
    expect(body.data.every((p: { bedrooms: number[] }) => p.bedrooms.includes(4))).toBe(true)
  })

  it('combines filters', async () => {
    const body = (await get('/api/properties?company=roland-realty&beds=4')).json()
    expect(body.data.map((p: { slug: string }) => p.slug).sort()).toEqual([
      'campus-circle',
      'roland-realty',
    ])
  })

  it('sorts by rating with unreviewed properties last', async () => {
    const body = (await get('/api/properties?sort=rating')).json()
    expect(body.data[0].slug).toBe('bankier-apartments')
    expect(body.data[0].averages.overall).toBe(4.5)
    expect(body.data.at(-1).averages.overall).toBeNull()
  })

  it('sorts by price', async () => {
    const body = (await get('/api/properties?sort=price')).json()
    expect(body.data[0].slug).toBe('smith-apartments')
  })

  it('sorts by review count', async () => {
    const body = (await get('/api/properties?sort=reviews')).json()
    expect(body.data[0].reviewCount).toBe(2)
  })

  it('returns averages as numbers, not the strings node-postgres gives back', async () => {
    const body = (await get('/api/properties?q=bankier')).json()
    expect(typeof body.data[0].averages.overall).toBe('number')
    expect(typeof body.data[0].reviewCount).toBe('number')
  })

  it('reports an unreviewed property as zero reviews with null averages', async () => {
    const body = (await get('/api/properties?q=green%20street%20towers')).json()
    expect(body.data[0].reviewCount).toBe(0)
    expect(body.data[0].averages).toEqual({
      overall: null,
      maintenance: null,
      communication: null,
      value: null,
    })
  })

  it('rejects an unknown sort key', async () => {
    const response = await get('/api/properties?sort=cheapest')
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('validation_failed')
  })

  it('rejects a page below one', async () => {
    expect((await get('/api/properties?page=0')).statusCode).toBe(400)
  })

  it('refuses a perPage above the cap, so one request cannot ask for everything', async () => {
    expect((await get('/api/properties?perPage=5000')).statusCode).toBe(400)
  })

  it('rejects a non-numeric bedroom filter', async () => {
    expect((await get('/api/properties?beds=studio')).statusCode).toBe(400)
  })
})

describe('GET /api/properties/:slug', () => {
  it('returns the property with a page of reviews', async () => {
    const response = await get('/api/properties/here-champaign')
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.slug).toBe('here-champaign')
    expect(body.company.slug).toBe('core-spaces')
    expect(body.reviewCount).toBe(2)
    expect(body.reviews.total).toBe(2)
    expect(body.reviews.data).toHaveLength(2)
    expect(body.reviews.data[0].leaseTerm).toBeTruthy()
    expect(body.reviews.data[0].isSample).toBe(true)
  })

  it('pages reviews independently of the property', async () => {
    const body = (await get('/api/properties/here-champaign?perPage=1')).json()
    expect(body.reviews.data).toHaveLength(1)
    expect(body.reviews.totalPages).toBe(2)
  })

  it('returns 404 for a slug that does not exist', async () => {
    const response = await get('/api/properties/no-such-building')
    expect(response.statusCode).toBe(404)
    expect(response.json().error.code).toBe('not_found')
  })

  it('rejects a malformed slug before touching the database', async () => {
    const response = await get('/api/properties/Not%20A%20Slug')
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('validation_failed')
  })
})

describe('pagination and search edge cases', () => {
  it('reports the real total when asked for a page past the end', async () => {
    const body = (await get('/api/properties?perPage=3&page=9')).json()
    expect(body.data).toHaveLength(0)
    // Not 0: the filter still matches 8 properties, the page is simply empty.
    expect(body.total).toBe(8)
    expect(body.totalPages).toBe(3)
  })

  it('reports the real review total past the last review page', async () => {
    const body = (await get('/api/properties/here-champaign?perPage=1&page=9')).json()
    expect(body.reviews.data).toHaveLength(0)
    expect(body.reviews.total).toBe(2)
  })

  it('treats a percent sign as a literal, not a wildcard', async () => {
    const body = (await get('/api/properties?q=%25')).json()
    expect(body.total).toBe(0)
  })

  it('treats an underscore as a literal, not a single-character wildcard', async () => {
    const body = (await get('/api/properties?q=_')).json()
    expect(body.total).toBe(0)
  })
})

describe('query parsing tolerates what real clients send', () => {
  it('treats an empty q as no search rather than an error', async () => {
    const response = await get('/api/properties?q=')
    expect(response.statusCode).toBe(200)
    expect(response.json().total).toBe(8)
  })

  it('treats empty paging parameters as absent', async () => {
    const response = await get('/api/properties?page=&perPage=&maxRent=&sort=')
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.page).toBe(1)
    expect(body.perPage).toBe(24)
    expect(body.total).toBe(8)
  })

  it('accepts repeated keys as the multi-value form', async () => {
    const body = (await get('/api/properties?company=jsm&company=roland-realty')).json()
    expect(body.total).toBe(4)
  })

  it('accepts repeated keys and comma lists interchangeably', async () => {
    const repeated = (await get('/api/properties?beds=1&beds=4')).json()
    const comma = (await get('/api/properties?beds=1,4')).json()
    expect(repeated.total).toBe(comma.total)
    expect(repeated.total).toBeGreaterThan(0)
  })

  it('still rejects a genuinely invalid bedroom filter', async () => {
    expect((await get('/api/properties?beds=studio')).statusCode).toBe(400)
  })

  it('still rejects an unknown sort key', async () => {
    expect((await get('/api/properties?sort=cheapest')).statusCode).toBe(400)
  })
})

describe('GET /api/filters', () => {
  it('lists the options the directory filters on, drawn from the data', async () => {
    const response = await get('/api/filters')
    expect(response.statusCode).toBe(200)
    const body = response.json()

    const { rows: companies } = await pool.query('select slug, name from management_companies order by name, slug')
    expect(body.companies).toEqual(companies)

    const { rows: hoods } = await pool.query('select distinct neighborhood from properties where neighborhood is not null order by 1')
    expect(body.neighborhoods).toEqual(hoods.map((r) => r.neighborhood))

    const { rows: beds } = await pool.query('select distinct unnest(bedrooms) as b from properties order by 1')
    expect(body.bedrooms).toEqual(beds.map((r) => r.b))

    const { rows: rent } = await pool.query('select max(rent_max) as m from properties')
    expect(body.maxRent).toBe(rent[0].m)
  })
})

describe('a property with unknown rent and neighborhood', () => {
  const slug = `unknown-rent-${crypto.randomUUID().slice(0, 8)}`
  beforeAll(async () => {
    await pool.query(`insert into properties (slug, name, address) values ($1, 'Unknown Rent Hall', '1 Unknown St, Champaign')`, [slug])
  })
  afterAll(async () => {
    await pool.query('delete from properties where slug = $1', [slug])
  })

  it('is listed with nulls, sorts last by price, and never matches a rent limit', async () => {
    const byPrice = (await get('/api/properties?sort=price&perPage=100')).json()
    const last = byPrice.data.at(-1)
    expect(byPrice.page).toBe(byPrice.totalPages)
    expect(last).toMatchObject({ slug, rentMin: null, rentMax: null, neighborhood: null })

    const limited = (await get('/api/properties?maxRent=100000&perPage=100')).json()
    expect(limited.data.map((p: { slug: string }) => p.slug)).not.toContain(slug)
  })

  it('adds no empty neighborhood to the filters', async () => {
    expect((await get('/api/filters')).json().neighborhoods).not.toContain(null)
  })
})

describe('visibility', () => {
  const tag = crypto.randomUUID().slice(0, 8)
  const slug = (v: string) => `vis-${tag}-${v}`
  beforeAll(async () => {
    for (const v of ['search_only', 'hidden']) {
      await pool.query(
        `insert into properties (slug, name, address, visibility) values ($1, $2, $3, $4)`,
        [slug(v), `Vis${tag} ${v}`, `1 Vis${tag} St, Champaign`, v]
      )
    }
  })
  afterAll(async () => {
    await pool.query('delete from properties where slug like $1', [`vis-${tag}-%`])
  })
  const slugs = async (url: string) => (await get(url)).json().data.map((p: { slug: string }) => p.slug)

  it('browsing shows only listed buildings', async () => {
    const all = await slugs('/api/properties?perPage=100')
    expect(all).not.toContain(slug('search_only'))
    expect(all).not.toContain(slug('hidden'))
  })

  it('a search also finds search-only buildings, never hidden ones', async () => {
    expect(await slugs(`/api/properties?q=Vis${tag}`)).toEqual([slug('search_only')])
    expect((await get(`/api/properties?q=Vis${tag}`)).json().total).toBe(1)
  })

  it('a hidden building still has its own page', async () => {
    expect((await get(`/api/properties/${slug('hidden')}`)).statusCode).toBe(200)
  })
})

