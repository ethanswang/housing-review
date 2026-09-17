import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Client } from 'pg'
import {
  VALID_BODY, connect, insertCompany, insertProperty, insertReview, insertUser,
} from './helpers.js'

let db: Client

beforeAll(async () => { db = await connect() })
afterAll(async () => { await db.end() })
beforeEach(async () => { await db.query('begin') })
afterEach(async () => { await db.query('rollback') })

describe('users', () => {
  it('rejects an email outside illinois.edu', async () => {
    await expect(insertUser(db, 'someone@gmail.com')).rejects.toMatchObject({ code: '23514' })
  })

  it('accepts a department subdomain address', async () => {
    await expect(insertUser(db, 'someone@cs.illinois.edu')).resolves.toBeTruthy()
  })

  it('treats emails case-insensitively for uniqueness', async () => {
    await insertUser(db, 'dupe@illinois.edu')
    await expect(insertUser(db, 'DUPE@illinois.edu')).rejects.toMatchObject({ code: '23505' })
  })

  it('rejects an unknown role', async () => {
    await expect(insertUser(db, 'role@illinois.edu', 'superuser')).rejects.toMatchObject({ code: '23514' })
  })
})

describe('reviews', () => {
  it('rejects a rating outside 1-5', async () => {
    const property = await insertProperty(db)
    await expect(insertReview(db, property, { overall: 6 })).rejects.toMatchObject({ code: '23514' })
  })

  it('rejects a body under 20 characters', async () => {
    const property = await insertProperty(db)
    await expect(insertReview(db, property, { body: 'too short' })).rejects.toMatchObject({ code: '23514' })
  })

  it('allows one review per author per property and rejects a second', async () => {
    const property = await insertProperty(db)
    const author = await insertUser(db)
    await insertReview(db, property, { author_id: author })
    await expect(insertReview(db, property, { author_id: author })).rejects.toMatchObject({ code: '23505' })
  })

  it('allows the same author to review two different properties', async () => {
    const author = await insertUser(db)
    const first = await insertProperty(db)
    const second = await insertProperty(db)
    await insertReview(db, first, { author_id: author })
    await expect(insertReview(db, second, { author_id: author })).resolves.toBeTruthy()
  })

  it('allows several authorless legacy rows on one property', async () => {
    const property = await insertProperty(db)
    await insertReview(db, property)
    await expect(insertReview(db, property)).resolves.toBeTruthy()
  })

  it('refuses to mark an authored review as sample data', async () => {
    const property = await insertProperty(db)
    const author = await insertUser(db)
    await expect(
      insertReview(db, property, { author_id: author, is_sample: true })
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('deletes reviews when the property is deleted', async () => {
    const property = await insertProperty(db)
    await insertReview(db, property)
    await db.query('delete from properties where id = $1', [property])
    const { rows } = await db.query('select count(*)::int as n from reviews where property_id = $1', [property])
    expect(rows[0].n).toBe(0)
  })

  it('keeps the review but clears the author when the user is deleted', async () => {
    const property = await insertProperty(db)
    const author = await insertUser(db)
    const review = await insertReview(db, property, { author_id: author })
    await db.query('delete from users where id = $1', [author])
    const { rows } = await db.query('select author_id from reviews where id = $1', [review])
    expect(rows).toHaveLength(1)
    expect(rows[0].author_id).toBeNull()
  })
})

describe('review_reports', () => {
  it('rejects a second report of the same review by the same person', async () => {
    const property = await insertProperty(db)
    const review = await insertReview(db, property)
    const reporter = await insertUser(db)
    const report = async () =>
      db.query(
        `insert into review_reports (review_id, reporter_id, reason) values ($1, $2, 'spam')`,
        [review, reporter]
      )
    await report()
    await expect(report()).rejects.toMatchObject({ code: '23505' })
  })

  it('refuses a resolved status without a resolution timestamp', async () => {
    const property = await insertProperty(db)
    const review = await insertReview(db, property)
    const reporter = await insertUser(db)
    await expect(
      db.query(
        `insert into review_reports (review_id, reporter_id, reason, status)
         values ($1, $2, 'spam', 'dismissed')`,
        [review, reporter]
      )
    ).rejects.toMatchObject({ code: '23514' })
  })
})

describe('property_stats', () => {
  it('reports zero reviews and null averages for an unreviewed property', async () => {
    const property = await insertProperty(db)
    const { rows } = await db.query('select * from property_stats where id = $1', [property])
    expect(rows[0].review_count).toBe(0)
    expect(rows[0].avg_overall).toBeNull()
  })

  it('averages published reviews to one decimal place', async () => {
    const property = await insertProperty(db)
    await insertReview(db, property, { overall: 4 })
    await insertReview(db, property, { overall: 3 })
    const { rows } = await db.query('select review_count, avg_overall from property_stats where id = $1', [property])
    expect(rows[0].review_count).toBe(2)
    expect(Number(rows[0].avg_overall)).toBe(3.5)
  })

  it('excludes hidden and removed reviews from the aggregate', async () => {
    const property = await insertProperty(db)
    await insertReview(db, property, { overall: 5 })
    await insertReview(db, property, { overall: 1, status: 'hidden' })
    await insertReview(db, property, { overall: 1, status: 'removed' })
    const { rows } = await db.query('select review_count, avg_overall from property_stats where id = $1', [property])
    expect(rows[0].review_count).toBe(1)
    expect(Number(rows[0].avg_overall)).toBe(5)
  })

  it('exposes the joined company for a property', async () => {
    const company = await insertCompany(db)
    const property = await insertProperty(db, company)
    const { rows } = await db.query('select company_slug, company_name from property_stats where id = $1', [property])
    expect(rows[0].company_name).toBe('Test Company')
    expect(rows[0].company_slug).toBeTruthy()
  })
})

describe('company_stats', () => {
  it('averages across every property the company manages', async () => {
    const company = await insertCompany(db)
    const first = await insertProperty(db, company)
    const second = await insertProperty(db, company)
    await insertReview(db, first, { overall: 5 })
    await insertReview(db, second, { overall: 2 })
    await insertReview(db, second, { overall: 2 })
    const { rows } = await db.query(
      'select property_count, review_count, avg_overall from company_stats where id = $1',
      [company]
    )
    expect(rows[0].property_count).toBe(2)
    expect(rows[0].review_count).toBe(3)
    expect(Number(rows[0].avg_overall)).toBe(3)
  })

  it('reports null averages for a company with no reviews', async () => {
    const company = await insertCompany(db)
    await insertProperty(db, company)
    const { rows } = await db.query('select review_count, avg_overall from company_stats where id = $1', [company])
    expect(rows[0].review_count).toBe(0)
    expect(rows[0].avg_overall).toBeNull()
  })
})

describe('properties', () => {
  it('rejects a rent range where the maximum is below the minimum', async () => {
    await expect(
      db.query(
        `insert into properties (name, slug, address, neighborhood, rent_min, rent_max)
         values ('Bad', 'bad-range', 'x', 'Campustown', 1200, 700)`
      )
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('keeps properties when their company is deleted', async () => {
    const company = await insertCompany(db)
    const property = await insertProperty(db, company)
    await db.query('delete from management_companies where id = $1', [company])
    const { rows } = await db.query('select company_id from properties where id = $1', [property])
    expect(rows[0].company_id).toBeNull()
  })
})

describe('seed body length', () => {
  it('uses a body long enough for the constraint', () => {
    expect(VALID_BODY.length).toBeGreaterThanOrEqual(20)
  })
})
