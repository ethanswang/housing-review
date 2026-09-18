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
const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL, LOG_LEVEL: 'silent' })

let app: FastifyInstance
let pool: Database

const get = (url: string) => app.inject({ method: 'GET', url })

beforeAll(async () => {
  pool = createPool(DATABASE_URL)
  app = buildApp({ config, db: pool })
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
