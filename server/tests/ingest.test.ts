import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Client } from 'pg'
import { normalizeAddress, normalizeCompanyName } from '../src/ingest/address.ts'
import { TARGET_AREA } from '../src/ingest/config.ts'
import { importRecords } from '../src/ingest/importer.ts'
import { fetchAll, transform, type GisFeature } from '../src/ingest/sources/champaign-gis.ts'
import type { SourceRecord } from '../src/ingest/types.ts'
import { connect } from './helpers.ts'

describe('normalizeAddress', () => {
  it('ignores case, punctuation, spacing, state and ZIP, and abbreviates the street type', () => {
    const key = '809 S FIRST ST|CHAMPAIGN'
    expect(normalizeAddress('809 S. First Street, Champaign, IL 61820')).toBe(key)
    expect(normalizeAddress('809  s first st', 'Champaign')).toBe(key)
    expect(normalizeAddress('809 South First St, Champaign')).toBe(key)
  })

  it('keeps apart what could be different buildings', () => {
    expect(normalizeAddress('809 S First St, Champaign')).not.toBe(normalizeAddress('811 S First St, Champaign'))
    expect(normalizeAddress('809 S First St, Champaign')).not.toBe(normalizeAddress('809 N First St, Champaign'))
    expect(normalizeAddress('809 S First St, Champaign')).not.toBe(normalizeAddress('809 S First St, Urbana'))
  })

  it('only abbreviates a direction or street type where it cannot be part of the name', () => {
    // A street named North, and "Court" as part of a name.
    expect(normalizeAddress('100 North St', 'Champaign')).toBe('100 NORTH ST|CHAMPAIGN')
    expect(normalizeAddress('5 Avenue Court Drive', 'Champaign')).toBe('5 AVENUE COURT DR|CHAMPAIGN')
  })

  it('refuses what cannot be matched safely', () => {
    expect(normalizeAddress('809 S First St')).toBeNull() // no city
    expect(normalizeAddress('500 block of E Green St, Champaign')).toBeNull()
    expect(normalizeAddress('Green Street Towers, Champaign')).toBeNull()
  })

  it('accepts an address range', () => {
    expect(normalizeAddress('207-211 Locust St', 'Champaign')).toBe('207-211 LOCUST ST|CHAMPAIGN')
  })
})

describe('normalizeCompanyName', () => {
  it('compares names without case, punctuation or "&"', () => {
    expect(normalizeCompanyName('Royse + Brinkmeyer')).toBe(normalizeCompanyName('royse brinkmeyer'))
    expect(normalizeCompanyName('M & H, Inc.')).toBe('m and h inc')
  })
})

const square = (lon: number, lat: number, d = 0.0002) => ({
  type: 'Polygon',
  coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]],
})

describe('champaign_gis transform', () => {
  const feature = (properties: Record<string, unknown>): GisFeature => ({
    properties: { GlobalID: '{ABC}', Address: '1009 S First St', ...properties },
    geometry: square(-88.2385, 40.1078),
  })

  it('maps the layer to the shared shape, with blanks as null', () => {
    expect(
      transform(
        feature({
          Units: '36', Stories: '3 ', Building_Name: 'Stadium View Apartments', Complex_Name: ' ',
          Building_Type: 'Building', Managing_Company: null,
        })
      )
    ).toEqual({
      source: 'champaign_gis',
      sourceId: '{ABC}',
      name: 'Stadium View Apartments',
      complexName: null,
      street: '1009 S First St',
      city: 'Champaign',
      latitude: expect.closeTo(40.1079, 4),
      longitude: expect.closeTo(-88.2384, 4),
      unitCount: 36,
      stories: 3,
      propertyType: 'multi_unit',
      manager: null,
      raw: expect.objectContaining({ Building_Type: 'Building', Managing_Company: null }),
    })
  })

  it('maps building types to the shared vocabulary, and unknown values to other', () => {
    const type = (Building_Type: unknown) => (transform(feature({ Building_Type })) as SourceRecord).propertyType
    expect([type('Complex'), type('Over Commercial'), type('House'), type('Fraternity or Sorority'), type('Other')])
      .toEqual(['apartment', 'multi_unit', 'house', 'greek_house', 'other'])
    expect(type('Something New')).toBe('other')
    expect(type(null)).toBeNull()
  })

  it('keeps the manager exactly as the source spelled it', () => {
    expect((transform(feature({ Managing_Company: 'Green Streeet Realty' })) as SourceRecord).manager).toBe('Green Streeet Realty')
  })

  it('treats a count it cannot read as unknown, not zero', () => {
    const record = transform(feature({ Units: 'about 10', Stories: '0' })) as SourceRecord
    expect([record.unitCount, record.stories]).toEqual([null, null])
  })

  it('uses the building name as the address only when the address is blank and the name is one', () => {
    expect((transform(feature({ Address: '', Building_Name: '810 Cobblefield Rd' })) as SourceRecord).street).toBe('810 Cobblefield Rd')
    expect((transform(feature({ Address: '', Building_Name: 'The Tower' })) as SourceRecord).street).toBeNull()
  })

  it('reports records it cannot use instead of dropping them', () => {
    expect(transform({ properties: { Address: '1 Main St' }, geometry: square(-88, 40) })).toMatchObject({ reason: 'no GlobalID' })
    expect(transform({ properties: { GlobalID: '{X}', Address: '1 Main St' }, geometry: null })).toMatchObject({ reason: 'no usable outline' })
  })
})

describe('champaign_gis fetchAll', () => {
  const page = (n: number, start: number) => ({
    features: Array.from({ length: n }, (_, i) => ({ properties: { GlobalID: `{${start + i}}` }, geometry: null })),
  })

  it('pages until it has every record', async () => {
    const urls: string[] = []
    const features = await fetchAll('https://gis.test/layer', async (url) => {
      urls.push(url)
      if (url.includes('returnCountOnly')) return { count: 5 }
      const offset = Number(new URL(url).searchParams.get('resultOffset'))
      return page(Math.min(2, 5 - offset), offset)
    }, 2)
    expect(features).toHaveLength(5)
    expect(urls.filter((u) => u.includes('resultOffset')).map((u) => new URL(u).searchParams.get('resultOffset'))).toEqual(['0', '2', '4'])
  })

  it('fails rather than import a partial list', async () => {
    await expect(
      fetchAll('https://gis.test/layer', async (url) => (url.includes('returnCountOnly') ? { count: 5 } : page(0, 0)), 2)
    ).rejects.toThrow('reported 5 records but returned 0')
  })
})

describe('importRecords', () => {
  let db: Client
  const tag = crypto.randomUUID().slice(0, 8)
  const source = `test_${tag}`
  /** A street unique to this file, so cleanup and matching touch nothing else. */
  const street = (n: number) => `${n} Ingest${tag} St`
  const area = TARGET_AREA

  const record = (n: number, overrides: Partial<SourceRecord> = {}): SourceRecord => ({
    source,
    sourceId: `{${tag}-${n}}`,
    name: `Ingest ${tag} Building ${n}`,
    complexName: null,
    street: street(n),
    city: 'Champaign',
    latitude: area.latitude,
    longitude: area.longitude,
    unitCount: 12,
    stories: 3,
    propertyType: 'multi_unit',
    manager: null,
    raw: { n },
    ...overrides,
  })

  const run = (records: SourceRecord[], apply = true) => importRecords(db, source, records, [], { apply, area })

  const rows = async () =>
    (
      await db.query(
        `select p.id, p.name, p.address, p.rent_min, p.unit_count, p.stories, p.neighborhood,
                array_remove(array_agg(s.source_id order by s.source_id), null) as links
         from properties p left join property_sources s on s.property_id = p.id
         where p.address like $1 group by p.id order by p.address`,
        [`%Ingest${tag}%`]
      )
    ).rows

  beforeAll(async () => { db = await connect() })
  afterAll(async () => { await db?.end() })
  afterEach(async () => {
    await db.query('delete from properties where address like $1', [`%Ingest${tag}%`])
    await db.query('delete from management_companies where name like $1', [`%${tag}%`])
  })

  it('inserts new buildings and links them to their source record', async () => {
    const report = await run([record(1), record(2)])
    expect(report.counts).toMatchObject({ inserted: 2, errors: 0 })
    const found = await rows()
    expect(found.map((r) => [r.address, r.links])).toEqual([
      [`${street(1)}, Champaign`, [`{${tag}-1}`]],
      [`${street(2)}, Champaign`, [`{${tag}-2}`]],
    ])
    expect(found[0]).toMatchObject({ rent_min: null, neighborhood: null, unit_count: 12 })
  })

  it('creates nothing new when run again', async () => {
    await run([record(1), record(2)])
    const again = await run([record(1), record(2)])
    expect(again.counts).toMatchObject({ inserted: 0, unchanged: 2, updated: 0 })
    expect(await rows()).toHaveLength(2)
  })

  it('updates a linked property from its source record, matched by source id even if the address changed', async () => {
    await run([record(1)])
    const report = await run([record(1, { unitCount: 14, street: '999 Elsewhere Ave' })])
    expect(report.counts).toMatchObject({ updated: 1, inserted: 0 })
    const [row] = await rows()
    expect(row).toMatchObject({ unit_count: 14, address: `${street(1)}, Champaign` })
  })

  it('links a hand-entered property at the same address, keeping its curated values', async () => {
    const { rows: [manual] } = await db.query(
      `insert into properties (slug, name, address, neighborhood, rent_min, rent_max, unit_count)
       values ($1, 'Curated Name', $2, 'Campustown', 900, 1200, 40) returning id`,
      [`ingest-${tag}-manual`, `${street(1).replace(' St', ' Street')}, Champaign, IL 61820`]
    )
    const report = await run([record(1, { name: 'Different Name', unitCount: null, stories: 4 })])
    expect(report.counts).toMatchObject({ linkedByAddress: 1, inserted: 0 })
    expect(report.review[0]?.note).toContain('named "Curated Name"')
    const [row] = await rows()
    // Name, address, rent and neighborhood untouched; a null unit count does not erase 40.
    expect(row).toMatchObject({ id: manual.id, name: 'Curated Name', rent_min: 900, neighborhood: 'Campustown', unit_count: 40, stories: 4 })
  })

  it('never merges when the match is uncertain', async () => {
    for (const n of [1, 2]) {
      await db.query(
        `insert into properties (slug, name, address) values ($1, 'Twin', $2)`,
        [`ingest-${tag}-twin-${n}`, `${street(1)}, Champaign`]
      )
    }
    const report = await run([record(1)])
    expect(report.counts).toMatchObject({ ambiguous: 1, inserted: 0, linkedByAddress: 0 })
    expect(report.ambiguous[0]?.reason).toBe('2 properties at this address, none clearly this one')
    expect((await rows()).every((r) => r.links.length === 0)).toBe(true)
  })

  it('keeps two records of one source at one address as two buildings, and notes it', async () => {
    // About 55 m apart: a complex sharing a street number.
    const report = await run([record(1), record(9, { street: street(1), latitude: area.latitude + 0.0005 })])
    expect(report.counts).toMatchObject({ inserted: 2, ambiguous: 0 })
    expect(report.review.map((r) => r.note)).toEqual([`shares its address with 1 other ${source} record(s)`])
    expect(await rows()).toHaveLength(2)
  })

  it('reports, rather than imports, the same building entered twice by a source', async () => {
    const report = await run([record(1), record(9, { street: street(1) })])
    expect(report.counts).toMatchObject({ inserted: 1, ambiguous: 1 })
    expect(report.ambiguous[0]).toMatchObject({ sourceId: `{${tag}-9}`, normalizedAddress: `1 INGEST${tag.toUpperCase()} ST|CHAMPAIGN` })
  })

  it('remembers what an address match just learned, so a twin later in the run is still caught', async () => {
    await db.query(`insert into properties (slug, name, address) values ($1, 'No coordinates yet', $2)`, [`ingest-${tag}-p`, `${street(1)}, Champaign`])
    const report = await run([record(1), record(9, { street: street(1) })])
    expect(report.counts).toMatchObject({ linkedByAddress: 1, inserted: 0, ambiguous: 1 })
  })

  it('does not link across sources at the same address when the locations disagree', async () => {
    await db.query(
      `insert into properties (slug, name, address, latitude, longitude) values ($1, 'Far', $2, $3, $4)`,
      [`ingest-${tag}-far`, `${street(1)}, Champaign`, area.latitude + 0.01, area.longitude]
    )
    const report = await run([record(1)])
    expect(report.counts).toMatchObject({ ambiguous: 1, linkedByAddress: 0, inserted: 0 })
    expect(report.ambiguous[0]?.reason).toMatch(/m apart/)
  })

  it('picks the one nearby, same-named candidate when several share an address', async () => {
    for (const [n, name, dLat] of [[1, 'Ingest Hall', 0], [2, 'Other Hall', 0], [3, 'Ingest Hall', 0.01]] as const) {
      await db.query(
        `insert into properties (slug, name, address, latitude, longitude) values ($1, $2, $3, $4, $5)`,
        [`ingest-${tag}-cand-${n}`, name, `${street(1)}, Champaign`, area.latitude + dLat, area.longitude]
      )
    }
    const report = await run([record(1, { name: 'Ingest Hall' })])
    expect(report.counts).toMatchObject({ linkedByAddress: 1, ambiguous: 0 })
    const linked = (await rows()).filter((r) => r.links.length)
    expect(linked.map((r) => r.name)).toEqual(['Ingest Hall'])
  })

  it('writes nothing on a dry run', async () => {
    const report = await run([record(1)], false)
    expect(report.counts.inserted).toBe(1)
    expect(await rows()).toHaveLength(0)
  })

  it('writes nothing if the report cannot be written', async () => {
    await expect(
      importRecords(db, source, [record(1)], [], {
        apply: true,
        area,
        beforeFinish: () => { throw new Error('disk full') },
      })
    ).rejects.toThrow('disk full')
    expect(await rows()).toHaveLength(0)
  })

  it('skips buildings outside the target area', async () => {
    const report = await run([record(1, { latitude: 40.2, longitude: -88.4 })])
    expect(report.counts).toMatchObject({ outsideArea: 1, inserted: 0 })
  })

  it('rolls back only the record that fails', async () => {
    const report = await run([record(1, { name: 'x'.repeat(121) }), record(2)])
    expect(report.counts).toMatchObject({ errors: 1, inserted: 1 })
    expect((await rows()).map((r) => r.address)).toEqual([`${street(2)}, Champaign`])
  })

  it('forgets what a failed record did, so later records are not affected', async () => {
    const manager = `Ghost ${tag} Realty`
    const report = await run([record(1, { name: 'x'.repeat(121), manager }), record(2)])
    expect(report.counts).toMatchObject({ errors: 1, inserted: 1, managersToReview: 0 })
  })

  it('stores no company when the source names none', async () => {
    await run([record(1)])
    const { rows: [row] } = await db.query('select company_id from properties where address like $1', [`%Ingest${tag}%`])
    expect(row.company_id).toBeNull()
  })

  it('never creates a company: an unknown name is kept raw and listed, with a suggestion', async () => {
    await db.query(`insert into management_companies (slug, name) values ($1, $2)`, [`ingest-${tag}-real`, `Real ${tag} Realty`])
    const report = await run([
      record(1, { manager: `Reel ${tag} Realty`, raw: { Managing_Company: `Reel ${tag} Realty` } }),
      record(2, { manager: `reel ${tag} realty` }),
    ])
    expect(report.managers).toEqual([{ name: `Reel ${tag} Realty`, suggestion: `Real ${tag} Realty`, sourceIds: [`{${tag}-1}`, `{${tag}-2}`] }])
    const { rows: [link] } = await db.query(`select raw from property_sources where source = $1 and source_id = $2`, [source, `{${tag}-1}`])
    expect(link.raw).toEqual({ Managing_Company: `Reel ${tag} Realty` })
    expect((await db.query('select count(*)::int as n from management_companies where name ilike $1', [`%reel ${tag}%`])).rows[0].n).toBe(0)
  })

  it('sets the canonical company through an alias, and fills it in on a later run', async () => {
    const { rows: [real] } = await db.query(
      `insert into management_companies (slug, name) values ($1, $2) returning id`, [`ingest-${tag}-alias`, `Alias ${tag} Co`]
    )
    await run([record(1, { manager: `Alias ${tag} Coo` })])
    await db.query(
      `insert into management_company_aliases (alias_normalized, alias, company_id) values ($1, $2, $3)`,
      [`alias ${tag} coo`, `Alias ${tag} Coo`, real.id]
    )
    const report = await run([record(1, { manager: `Alias ${tag} Coo` })])
    expect(report.counts).toMatchObject({ updated: 1, managersToReview: 0 })
    const { rows: [row] } = await db.query('select company_id from properties where address like $1', [`%Ingest${tag}%`])
    expect(row.company_id).toBe(real.id)
  })

  it('looks up no company for a property that already has one', async () => {
    const { rows: [acme] } = await db.query(
      `insert into management_companies (slug, name) values ($1, $2) returning id`,
      [`ingest-${tag}-curated`, `Curated ${tag} Co`]
    )
    await db.query(
      `insert into properties (slug, name, address, company_id) values ($1, 'Owned', $2, $3)`,
      [`ingest-${tag}-owned`, `${street(1)}, Champaign`, acme.id]
    )
    const report = await run([record(1, { manager: `Source ${tag} Spelling` })])
    expect(report.counts).toMatchObject({ linkedByAddress: 1, managersToReview: 0 })
  })

  it('sets visibility from the type on import: houses search-only, Greek houses hidden', async () => {
    await run([
      record(1, { propertyType: 'apartment' }),
      record(2, { propertyType: 'house' }),
      record(3, { propertyType: 'greek_house' }),
      record(4, { propertyType: null }),
    ])
    const { rows: found } = await db.query(
      'select property_type, visibility from properties where address like $1 order by address', [`%Ingest${tag}%`]
    )
    expect(found).toEqual([
      { property_type: 'apartment', visibility: 'listed' },
      { property_type: 'house', visibility: 'search_only' },
      { property_type: 'greek_house', visibility: 'hidden' },
      { property_type: null, visibility: 'search_only' },
    ])
  })
})
