import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Client } from 'pg'
import { TARGET_AREA } from '../src/ingest/config.ts'
import { importRecords } from '../src/ingest/importer.ts'
import { coordinates, fetchAll, transform, urbanaRental } from '../src/ingest/sources/urbana-rental.ts'
import type { SourceRecord } from '../src/ingest/types.ts'
import { connect } from './helpers.ts'

/** A row as data.illinois.gov returns it, including its swapped georeference. */
const row = (overrides: Record<string, unknown> = {}) => ({
  property_address: '807 North Mathews Avenue',
  parcel_number: '912107105012',
  inspection_date: '2023-05-01T00:00:00.000',
  grade: 'Class B',
  license_status: 'Issued',
  expiration_date: '2027-05-01T00:00:00.000',
  mappable_address: '807 North Mathews Avenue Urbana,IL (-88.2265, 40.1155)',
  georeference: { type: 'Point', coordinates: [40.1155, -88.2265] },
  ...overrides,
})

describe('urbana_rental transform', () => {
  it('maps a row to the shared shape, keyed by parcel, with type and size unknown', () => {
    expect(transform(row())).toEqual({
      source: 'urbana_rental',
      sourceId: '912107105012',
      name: null,
      complexName: null,
      street: '807 North Mathews Avenue',
      city: 'Urbana',
      latitude: 40.1155,
      longitude: -88.2265,
      unitCount: null,
      stories: null,
      propertyType: null,
      manager: null,
      raw: row(),
    })
  })

  it('reads coordinates in the order the address states, and only falls back to the swapped point', () => {
    expect(coordinates(row())).toEqual({ latitude: 40.1155, longitude: -88.2265 })
    expect(coordinates(row({ mappable_address: 'no coordinates here' }))).toEqual({ latitude: 40.1155, longitude: -88.2265 })
    expect(coordinates(row({ mappable_address: null, georeference: { coordinates: [0, 0] } }))).toBeNull()
  })

  it('skips a property its owner says is not currently a rental, and reports broken rows', () => {
    expect(transform(row({ license_status: 'Temporarily Not a Rental' }))).toMatchObject({ reason: 'not currently a rental', outOfScope: true })
    expect(transform(row({ parcel_number: ' ' }))).toMatchObject({ reason: 'no parcel number' })
    expect(transform(row({ property_address: null }))).toMatchObject({ reason: 'no address' })
  })
})

describe('urbana_rental units', () => {
  it('drops the unit from an address, and keeps one record per building', async () => {
    const rows = [
      row({ parcel_number: '2', property_address: '502 West Green Street Apt N3' }),
      row({ parcel_number: '1', property_address: '502 West Green Street Apt N1' }),
      row({ parcel_number: '3', property_address: '807 North Mathews Avenue' }),
    ]
    const source = urbanaRental({ fetchJson: async (url) => (url.includes('select') ? [{ count: '3' }] : rows) })
    const { records, problems } = await source.fetchRecords()
    expect(records.map((r) => [r.sourceId, r.street])).toEqual([
      ['1', '502 West Green Street'],
      ['3', '807 North Mathews Avenue'],
    ])
    expect(problems).toEqual([expect.objectContaining({ sourceId: '2', reason: 'another unit of a building already listed', outOfScope: true })])
  })
})

describe('urbana_rental fetchAll', () => {
  it('pages by offset until it has the reported count, and fails on a shortfall', async () => {
    const data = Array.from({ length: 5 }, (_, i) => row({ parcel_number: String(i) }))
    const fetchJson = async (url: string) => {
      const params = new URL(url).searchParams
      if (params.get('$select')) return [{ count: '5' }]
      const offset = Number(params.get('$offset'))
      return data.slice(offset, offset + Number(params.get('$limit')))
    }
    expect(await fetchAll('https://portal.test/r.json', fetchJson, 2)).toHaveLength(5)
    await expect(fetchAll('https://portal.test/r.json', async (url) => (url.includes('select') ? [{ count: '6' }] : data.slice(0, 0)), 2))
      .rejects.toThrow('reported 6 rows but returned 0')
  })
})

describe('importing urbana_rental', () => {
  let db: Client
  const tag = crypto.randomUUID().slice(0, 8)
  const source = `urbana_test_${tag}`
  const record = (n: number, overrides: Partial<SourceRecord> = {}): SourceRecord => ({
    ...(transform(row({ parcel_number: `${tag}${n}`, property_address: `${n} Urbanatest${tag} Street` })) as SourceRecord),
    source,
    ...overrides,
  })
  const run = (records: SourceRecord[]) => importRecords(db, source, records, [], { apply: true, area: TARGET_AREA })
  const count = async () =>
    (await db.query('select count(*)::int as n from properties where address like $1', [`%Urbanatest${tag}%`])).rows[0].n

  beforeAll(async () => { db = await connect() })
  afterAll(async () => { await db?.end() })
  afterEach(async () => { await db.query('delete from properties where address like $1', [`%Urbanatest${tag}%`]) })

  it('creates nothing new however often it runs', async () => {
    const records = [record(1), record(2), record(3)]
    expect((await run(records)).counts.inserted).toBe(3)
    for (let i = 0; i < 2; i++) {
      expect((await run(records)).counts).toMatchObject({ inserted: 0, unchanged: 3 })
    }
    expect(await count()).toBe(3)
  })

  it('stores Urbana rentals as search-only, with the address in Urbana and every source field kept', async () => {
    await run([record(1)])
    const { rows: [p] } = await db.query(
      `select p.address, p.visibility, p.property_type, s.raw->>'grade' as grade, s.raw->>'license_status' as status
       from properties p join property_sources s on s.property_id = p.id where p.address like $1`,
      [`%Urbanatest${tag}%`]
    )
    expect(p).toEqual({ address: `1 Urbanatest${tag} Street, Urbana`, visibility: 'search_only', property_type: null, grade: 'Class B', status: 'Issued' })
  })

  it('never matches a Champaign address with the same street and number', async () => {
    await db.query(
      `insert into properties (slug, name, address) values ($1, 'Champaign twin', $2)`,
      [`urbanatest-${tag}-champaign`, `1 Urbanatest${tag} St, Champaign`]
    )
    const report = await run([record(1)])
    expect(report.counts).toMatchObject({ inserted: 1, linkedByAddress: 0 })
  })
})
