import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { createPool, type Database } from '../src/db.ts'
import { DATABASE_URL } from './helpers.ts'

const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL, LOG_LEVEL: 'silent' })

let app: FastifyInstance
let pool: Database
const get = (url: string) => app.inject({ method: 'GET', url })

beforeAll(async () => {
  pool = createPool(DATABASE_URL)
  app = buildApp({ config, db: pool })
  await app.ready()
  const { rows } = await pool.query('select count(*)::int as n from management_companies')
  if (rows[0].n === 0) {
    throw new Error('No seed data. Run: npm run db:migrate && npm run db:seed')
  }
})

afterAll(async () => {
  await app?.close()
  await pool?.end()
})

describe('GET /api/companies', () => {
  it('lists every company with its rollup', async () => {
    const response = await get('/api/companies')
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.total).toBe(6)
    expect(body.data).toHaveLength(6)
  })

  it('rolls a company up across all of its properties', async () => {
    const body = (await get('/api/companies?sort=name')).json()
    const roland = body.data.find((c: { slug: string }) => c.slug === 'roland-realty')
    // Two buildings, one review between them.
    expect(roland.propertyCount).toBe(2)
    expect(roland.reviewCount).toBe(1)
    expect(roland.averages.overall).toBe(2)
  })

  it('reports null averages for a company with no reviews yet', async () => {
    const body = (await get('/api/companies?sort=name')).json()
    const jsm = body.data.find((c: { slug: string }) => c.slug === 'jsm')
    expect(jsm.propertyCount).toBe(2)
    expect(jsm.reviewCount).toBe(0)
    expect(jsm.averages.overall).toBeNull()
  })

  it('sorts by rating with unreviewed companies last', async () => {
    const body = (await get('/api/companies?sort=rating')).json()
    expect(body.data[0].slug).toBe('bankier-apartments')
    expect(body.data[0].averages.overall).toBe(4.5)
    expect(body.data.at(-1).averages.overall).toBeNull()
  })

  it('sorts by name', async () => {
    const body = (await get('/api/companies?sort=name')).json()
    const names = body.data.map((c: { name: string }) => c.name)
    expect(names).toEqual([...names].sort())
  })

  it('sorts by property count', async () => {
    const body = (await get('/api/companies?sort=properties')).json()
    expect(body.data[0].propertyCount).toBe(2)
  })

  it('returns averages as numbers', async () => {
    const body = (await get('/api/companies?sort=rating')).json()
    expect(typeof body.data[0].averages.overall).toBe('number')
  })

  it('pages without dropping companies', async () => {
    const first = (await get('/api/companies?perPage=4&page=1')).json()
    const second = (await get('/api/companies?perPage=4&page=2')).json()
    expect([first.data.length, second.data.length]).toEqual([4, 2])
    const slugs = [...first.data, ...second.data].map((c: { slug: string }) => c.slug)
    expect(new Set(slugs).size).toBe(6)
  })

  it('reports the real total past the last page', async () => {
    const body = (await get('/api/companies?perPage=4&page=9')).json()
    expect(body.data).toHaveLength(0)
    expect(body.total).toBe(6)
  })

  it('rejects an unknown sort key', async () => {
    expect((await get('/api/companies?sort=biggest')).statusCode).toBe(400)
  })

  it('treats empty parameters as absent', async () => {
    const response = await get('/api/companies?sort=&page=&perPage=')
    expect(response.statusCode).toBe(200)
    expect(response.json().total).toBe(6)
  })
})

describe('GET /api/companies/:slug', () => {
  it('returns the company with a page of its properties', async () => {
    const response = await get('/api/companies/roland-realty')
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.slug).toBe('roland-realty')
    expect(body.propertyCount).toBe(2)
    expect(body.properties.total).toBe(2)
    expect(body.properties.data.map((p: { slug: string }) => p.slug).sort()).toEqual([
      'campus-circle',
      'roland-realty',
    ])
  })

  it('pages the property list independently', async () => {
    const body = (await get('/api/companies/roland-realty?perPage=1')).json()
    expect(body.properties.data).toHaveLength(1)
    expect(body.properties.totalPages).toBe(2)
  })

  it('returns 404 for an unknown company', async () => {
    const response = await get('/api/companies/no-such-company')
    expect(response.statusCode).toBe(404)
    expect(response.json().error.code).toBe('not_found')
  })

  it('rejects a malformed slug before querying', async () => {
    const response = await get('/api/companies/Not%20A%20Slug')
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('validation_failed')
  })
})
