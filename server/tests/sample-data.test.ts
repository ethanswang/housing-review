import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Client } from 'pg'
import { removeSampleData, SAMPLE_PROPERTIES } from '../src/sample-data.ts'
import { connect, insertUser } from './helpers.ts'

/**
 * Against the dev seed, which holds the sample data, and only as dry runs, so
 * the seed survives for the other test files. A dry run reports exactly what an
 * applied run would delete.
 */
let db: Client
const changes: (() => Promise<unknown>)[] = []

beforeAll(async () => { db = await connect() })
afterAll(async () => { await db?.end() })
afterEach(async () => {
  for (const undo of changes.splice(0).reverse()) await undo()
})

const idOf = async (slug: string) => (await db.query('select id from properties where slug = $1', [slug])).rows[0]?.id as string

describe('removeSampleData', () => {
  it('would delete the sample reviews and the eight sample buildings, and nothing is deleted on a dry run', async () => {
    const before = (await db.query('select count(*)::int as n from properties')).rows[0].n
    const result = await removeSampleData(db, { apply: false })
    expect(result.sampleReviewsDeleted).toBeGreaterThan(0)
    expect(result.propertiesDeleted.sort()).toEqual(SAMPLE_PROPERTIES.map((p) => p.slug).sort())
    expect((await db.query('select count(*)::int as n from properties')).rows[0].n).toBe(before)
  })

  it('keeps a sample building that has a real review, a source link, or a different address', async () => {
    const reviewed = await idOf('lofts-54')
    const author = await insertUser(db)
    await db.query(
      `insert into reviews (property_id, author_id, maintenance, communication, value, overall, body, lease_term)
       values ($1, $2, 4, 4, 4, 4, 'A real tenant wrote this review, not the seed file.', '2025-26')`,
      [reviewed, author]
    )
    changes.push(() => db.query('delete from users where id = $1', [author]))
    changes.push(() => db.query('delete from reviews where author_id = $1', [author]))

    await db.query(
      `insert into property_sources (source, source_id, property_id, source_address) values ('test_sample', 'x', $1, 'x')`,
      [await idOf('campus-circle')]
    )
    changes.push(() => db.query(`delete from property_sources where source = 'test_sample'`))

    await db.query(`update properties set address = '702 S Third St, Champaign' where slug = 'roland-realty'`)
    changes.push(() => db.query(`update properties set address = '600 block of E Daniel St, Champaign' where slug = 'roland-realty'`))

    const result = await removeSampleData(db, { apply: false })
    expect(result.kept).toEqual([
      { slug: 'lofts-54', reason: 'has 1 review(s) that are not samples' },
      { slug: 'roland-realty', reason: 'address is "702 S Third St, Champaign", not the sample\'s' },
      { slug: 'campus-circle', reason: 'linked to a public-data source' },
    ])
    expect(result.propertiesDeleted).not.toContain('lofts-54')
  })

  it('touches no property outside its list', async () => {
    const result = await removeSampleData(db, { apply: false })
    const allowed = new Set<string>(SAMPLE_PROPERTIES.map((p) => p.slug))
    expect(result.propertiesDeleted.every((slug) => allowed.has(slug))).toBe(true)
  })
})
