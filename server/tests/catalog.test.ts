import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Client } from 'pg'
import { type Catalog, importCatalog, parseCatalog } from '../src/catalog.ts'
import { connect, insertReview } from './helpers.ts'

let db: Client

/** Every slug in this file carries the prefix, so cleanup touches nothing else. */
const prefix = `imp-${crypto.randomUUID().slice(0, 8)}`
const s = (name: string) => `${prefix}-${name}`

beforeAll(async () => { db = await connect() })
afterAll(async () => { await db?.end() })
afterEach(async () => {
  await db.query('delete from properties where slug like $1', [`${prefix}-%`])
  await db.query('delete from management_companies where slug like $1', [`${prefix}-%`])
})

function catalog(overrides: Partial<Catalog> = {}): Catalog {
  return parseCatalog({
    companies: [{ slug: s('acme'), name: 'Acme Rentals' }],
    properties: [
      {
        slug: s('tower'),
        name: 'Test Tower',
        address: '100 block of E Green St, Champaign',
        neighborhood: 'Campustown',
        rentMin: 800,
        rentMax: 1200,
        bedrooms: [1, 2],
        company: s('acme'),
      },
    ],
    ...overrides,
  })
}

const countBySlug = async (table: string, slug: string) =>
  (await db.query(`select count(*)::int as n from ${table} where slug = $1`, [slug])).rows[0].n

describe('importCatalog', () => {
  it('inserts new companies and properties when applied', async () => {
    const result = await importCatalog(db, catalog(), { apply: true })
    expect(result.companies).toEqual({ inserted: 1, updated: 0, unchanged: 0 })
    expect(result.properties).toEqual({ inserted: 1, updated: 0, unchanged: 0 })

    const { rows } = await db.query(
      `select p.bedrooms, c.slug as company from properties p
       join management_companies c on c.id = p.company_id where p.slug = $1`,
      [s('tower')]
    )
    expect(rows[0]).toEqual({ bedrooms: [1, 2], company: s('acme') })
  })

  it('writes nothing on a dry run, but reports what it would do', async () => {
    const result = await importCatalog(db, catalog(), { apply: false })
    expect(result.applied).toBe(false)
    expect(result.properties.inserted).toBe(1)
    expect(await countBySlug('properties', s('tower'))).toBe(0)
    expect(await countBySlug('management_companies', s('acme'))).toBe(0)
  })

  it('changes nothing when the same file is imported twice', async () => {
    await importCatalog(db, catalog(), { apply: true })
    const again = await importCatalog(db, catalog(), { apply: true })
    expect(again.companies).toEqual({ inserted: 0, updated: 0, unchanged: 1 })
    expect(again.properties).toEqual({ inserted: 0, updated: 0, unchanged: 1 })
  })

  it('treats a reordered bedroom list as unchanged', async () => {
    await importCatalog(db, catalog(), { apply: true })
    const [tower] = catalog().properties
    // Through parseCatalog, as the CLI does, so the normalisation is exercised.
    const reordered = catalog({
      properties: parseCatalog({ companies: [], properties: [{ ...tower, bedrooms: [2, 1, 2] }] }).properties,
    })
    const again = await importCatalog(db, reordered, { apply: true })
    expect(again.properties.unchanged).toBe(1)
  })

  it('updates only the rows whose fields changed', async () => {
    await importCatalog(db, catalog(), { apply: true })
    const edited = catalog()
    edited.properties[0]!.rentMax = 1300
    const result = await importCatalog(db, edited, { apply: true })
    expect(result.properties).toEqual({ inserted: 0, updated: 1, unchanged: 0 })
    expect(result.companies.unchanged).toBe(1)
    const { rows } = await db.query('select rent_max from properties where slug = $1', [s('tower')])
    expect(rows[0].rent_max).toBe(1300)
  })

  it('never deletes a property the file leaves out, or its reviews', async () => {
    await importCatalog(db, catalog(), { apply: true })
    const { rows } = await db.query('select id from properties where slug = $1', [s('tower')])
    await insertReview(db, rows[0].id)

    await importCatalog(db, catalog({ properties: [] }), { apply: true })
    expect(await countBySlug('properties', s('tower'))).toBe(1)
    const reviews = await db.query('select count(*)::int as n from reviews where property_id = $1', [rows[0].id])
    expect(reviews.rows[0].n).toBe(1)
  })

  it('accepts a company that already exists in the database', async () => {
    await importCatalog(db, catalog(), { apply: true })
    const result = await importCatalog(db, catalog({ companies: [] }), { apply: true })
    expect(result.properties.unchanged).toBe(1)
  })

  it('rolls back everything when a company slug is unknown', async () => {
    const bad = catalog()
    bad.properties[0]!.company = s('nobody')
    await expect(importCatalog(db, bad, { apply: true })).rejects.toThrow(/Unknown company/)
    // The company earlier in the same file was not left behind.
    expect(await countBySlug('management_companies', s('acme'))).toBe(0)
  })
})

describe('parseCatalog', () => {
  const property = {
    slug: 'a-place',
    name: 'A Place',
    address: '1 Main St',
    neighborhood: 'Urbana',
    rentMin: 500,
    rentMax: 700,
    bedrooms: [1],
    company: null,
  }

  it('rejects rentMax below rentMin', () => {
    expect(() => parseCatalog({ companies: [], properties: [{ ...property, rentMax: 400 }] })).toThrow(
      /rentMax/
    )
  })

  it('rejects a slug that is not a URL slug', () => {
    expect(() => parseCatalog({ companies: [], properties: [{ ...property, slug: 'A Place' }] })).toThrow(
      /slug/
    )
  })

  it('rejects the same slug twice', () => {
    expect(() => parseCatalog({ companies: [], properties: [property, property] })).toThrow(
      /duplicate slug "a-place"/
    )
  })

  it('reports every problem, not just the first', () => {
    const message = (() => {
      try {
        parseCatalog({ companies: [], properties: [{ ...property, rentMin: -1, slug: 'Bad' }] })
      } catch (error) {
        return (error as Error).message
      }
    })()
    expect(message).toMatch(/slug/)
    expect(message).toMatch(/rentMin/)
  })
})
