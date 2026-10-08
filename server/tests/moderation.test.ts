import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Client } from 'pg'
import { listRecent, listReported, moderate } from '../src/moderation.ts'
import { connect, insertProperty, insertReview, insertUser } from './helpers.ts'

let db: Client
const made: { properties: string[]; users: string[] } = { properties: [], users: [] }

beforeAll(async () => { db = await connect() })
afterAll(async () => { await db?.end() })
afterEach(async () => {
  await db.query('delete from properties where id = any($1::uuid[])', [made.properties.splice(0)])
  await db.query('delete from users where id = any($1::uuid[])', [made.users.splice(0)])
})

async function reportedReview(reasons: string[] = ['spam']) {
  const propertyId = await insertProperty(db)
  made.properties.push(propertyId)
  const reviewId = await insertReview(db, propertyId)
  for (const reason of reasons) {
    const reporter = await insertUser(db)
    made.users.push(reporter)
    await db.query(
      `insert into review_reports (review_id, reporter_id, reason, details) values ($1, $2, $3, 'It names the manager.')`,
      [reviewId, reporter, reason]
    )
  }
  return reviewId
}

const state = async (reviewId: string) => ({
  review: (await db.query('select status from reviews where id = $1', [reviewId])).rows[0].status,
  reports: (await db.query('select status from review_reports where review_id = $1 order by status', [reviewId])).rows.map((r) => r.status),
})

describe('moderation', () => {
  it('lists reviews with open reports, with their reasons and details', async () => {
    const reviewId = await reportedReview(['personal_info', 'harassment'])
    const listed = (await listReported(db)).find((r) => r.reviewId === reviewId)
    expect(listed).toMatchObject({ status: 'published', reports: 2, reasons: ['personal_info', 'harassment'] })
    expect(listed?.details).toEqual(['It names the manager.', 'It names the manager.'])
  })

  it('hides a review and closes its reports as actioned, only when applied', async () => {
    const reviewId = await reportedReview()
    expect(await moderate(db, 'hide', reviewId, { apply: false })).toEqual({ applied: false, review: 'changed', reportsClosed: 1 })
    expect(await state(reviewId)).toEqual({ review: 'published', reports: ['open'] })

    await moderate(db, 'hide', reviewId, { apply: true })
    expect(await state(reviewId)).toEqual({ review: 'hidden', reports: ['actioned'] })
    expect((await listReported(db)).some((r) => r.reviewId === reviewId)).toBe(false)
  })

  it('restores a hidden review', async () => {
    const reviewId = await reportedReview()
    await moderate(db, 'hide', reviewId, { apply: true })
    expect(await moderate(db, 'restore', reviewId, { apply: true })).toMatchObject({ review: 'changed', reportsClosed: 0 })
    expect((await state(reviewId)).review).toBe('published')
  })

  it('dismisses the reports and leaves the review up', async () => {
    const reviewId = await reportedReview()
    await moderate(db, 'dismiss', reviewId, { apply: true })
    expect(await state(reviewId)).toEqual({ review: 'published', reports: ['dismissed'] })
  })

  it('never touches a review its author withdrew, and refuses an unknown id', async () => {
    const propertyId = await insertProperty(db)
    made.properties.push(propertyId)
    const removed = await insertReview(db, propertyId, { status: 'removed' })
    await expect(moderate(db, 'hide', removed, { apply: true })).rejects.toThrow('is removed, so it cannot be hidden')
    await expect(moderate(db, 'restore', removed, { apply: true })).rejects.toThrow('cannot be restored')
    expect((await state(removed)).review).toBe('removed')
    await expect(moderate(db, 'hide', '00000000-0000-4000-8000-000000000000', { apply: true })).rejects.toThrow('No review')
  })

  it('lists recent reviews without the samples', async () => {
    const propertyId = await insertProperty(db)
    made.properties.push(propertyId)
    const real = await insertReview(db, propertyId)
    await insertReview(db, propertyId, { is_sample: true, author_id: null, body: 'A sample review that should not be listed here.' })
    const recent = await listRecent(db, 50)
    expect(recent.map((r) => r.reviewId)).toContain(real)
    expect(recent.every((r) => !r.body.startsWith('A sample review that should not'))).toBe(true)
  })
})
