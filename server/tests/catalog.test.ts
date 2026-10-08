import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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

describe('importCatalog aliases', () => {
  it('records a company\'s other spellings, normalized, pointing at it', async () => {
    await importCatalog(db, catalog({ companies: [{ slug: s('acme'), name: 'Acme Rentals', aliases: ['Acme Rentels, LLC'] }] }), { apply: true })
    const { rows } = await db.query(
      `select a.alias, a.alias_normalized, c.slug from management_company_aliases a
       join management_companies c on c.id = a.company_id where c.slug = $1`,
      [s('acme')]
    )
    expect(rows).toEqual([{ alias: 'Acme Rentels, LLC', alias_normalized: 'acme rentels llc', slug: s('acme') }])
  })
})

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

  it('rejects a company website that is not http or https', () => {
    for (const website of ['javascript:alert(1)', 'ftp://example.com']) {
      expect(() =>
        parseCatalog({ companies: [{ slug: 'co', name: 'Co', website }], properties: [] })
      ).toThrow(/website/)
    }
    expect(
      parseCatalog({ companies: [{ slug: 'co', name: 'Co', website: 'https://co.example' }], properties: [] })
        .companies[0]!.website
    ).toBe('https://co.example')
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

describe('importCatalog updates', () => {
  const imported = s('imported')
  beforeEach(async () => {
    await db.query(
      `insert into properties (slug, name, address, unit_count, latitude, longitude)
       values ($1, 'Imported Tower', '1 Imported St, Champaign', 120, 40.1, -88.2)`,
      [imported]
    )
  })
  const row = async () =>
    (await db.query(
      `select p.rent_min, p.rent_max, p.bedrooms, p.neighborhood, p.website, p.unit_count, c.slug as company
       from properties p left join management_companies c on c.id = p.company_id where p.slug = $1`,
      [imported]
    )).rows[0]
  const withUpdates = (updates: unknown[]) => parseCatalog({ companies: [{ slug: s('acme'), name: 'Acme Rentals' }], properties: [], updates })

  it('fills in only the fields given, and leaves the rest as imported', async () => {
    const result = await importCatalog(
      db,
      withUpdates([{ slug: imported, rentMin: 900, rentMax: 1400, bedrooms: [2, 1], company: s('acme'), website: 'https://tower.example' }]),
      { apply: true }
    )
    expect(result.updates).toEqual({ updated: 1, unchanged: 0 })
    expect(await row()).toEqual({
      rent_min: 900, rent_max: 1400, bedrooms: [1, 2], neighborhood: null,
      website: 'https://tower.example', unit_count: 120, company: s('acme'),
    })

    await importCatalog(db, withUpdates([{ slug: imported, neighborhood: 'Campustown' }]), { apply: true })
    expect(await row()).toMatchObject({ rent_min: 900, neighborhood: 'Campustown', website: 'https://tower.example' })
  })

  it('reports an unchanged update as unchanged, and writes nothing on a dry run', async () => {
    await importCatalog(db, withUpdates([{ slug: imported, neighborhood: 'Campustown' }]), { apply: true })
    const again = await importCatalog(db, withUpdates([{ slug: imported, neighborhood: 'Campustown' }]), { apply: true })
    expect(again.updates).toEqual({ updated: 0, unchanged: 1 })
    await importCatalog(db, withUpdates([{ slug: imported, neighborhood: 'Downtown' }]), { apply: false })
    expect((await row()).neighborhood).toBe('Campustown')
  })

  it('refuses an unknown building or company, and changes nothing', async () => {
    await expect(importCatalog(db, withUpdates([{ slug: s('nope'), neighborhood: 'X' }]), { apply: true }))
      .rejects.toThrow(`Unknown property slug(s) in updates: ${s('nope')}`)
    await expect(importCatalog(db, withUpdates([{ slug: imported, company: s('nobody') }]), { apply: true }))
      .rejects.toThrow('Unknown company slug(s) in updates')
    expect((await row()).company).toBeNull()
  })

  it('validates the file: rent as a pair, an http(s) website, something to change', () => {
    expect(() => withUpdates([{ slug: imported, rentMin: 900 }])).toThrow('give rentMin and rentMax together')
    expect(() => withUpdates([{ slug: imported, rentMin: 900, rentMax: 800 }])).toThrow('rentMax must be at least rentMin')
    expect(() => withUpdates([{ slug: imported, website: 'javascript:alert(1)' }])).toThrow('http:// or https://')
    expect(() => withUpdates([{ slug: imported }])).toThrow('nothing to update')
    expect(() => withUpdates([{ slug: imported, neighborhood: 'A' }, { slug: imported, neighborhood: 'B' }])).toThrow('duplicate slug')
  })

  it('keeps hand-entered details when the building is imported again', async () => {
    await importCatalog(db, withUpdates([{ slug: imported, rentMin: 900, rentMax: 1400, company: s('acme') }]), { apply: true })
    await db.query(`insert into property_sources (source, source_id, property_id, source_address)
                    select 'test_catalog', $1, id, '1 Imported St' from properties where slug = $1`, [imported])
    const { importRecords } = await import('../src/ingest/importer.ts')
    const { TARGET_AREA } = await import('../src/ingest/config.ts')
    await importRecords(db, 'test_catalog', [{
      source: 'test_catalog', sourceId: imported, name: 'Imported Tower', complexName: null, street: '1 Imported St',
      city: 'Champaign', latitude: TARGET_AREA.latitude, longitude: TARGET_AREA.longitude, unitCount: 130, stories: null,
      propertyType: 'apartment', manager: 'Someone Else', raw: {},
    }], [], { apply: true, area: TARGET_AREA })
    expect(await row()).toMatchObject({ rent_min: 900, rent_max: 1400, company: s('acme'), unit_count: 130 })
  })
})

