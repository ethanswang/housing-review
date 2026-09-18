import type { Database } from '../db.ts'
import { conflict, notFound } from '../errors.ts'

/**
 * Writes to reviews. Ownership is decided here and in the route that calls it;
 * the frontend is never consulted, because a client can send any request it
 * likes regardless of what its UI shows.
 */

export type ReviewInput = {
  maintenance: number
  communication: number
  value: number
  overall: number
  body: string
  leaseTerm: string
}

/** A PATCH may carry any subset; whatever is absent keeps its current value. */
export type ReviewPatch = Partial<ReviewInput>

export type OwnedReview = {
  id: string
  propertyId: string
  propertySlug: string
  authorId: string | null
  maintenance: number
  communication: number
  value: number
  overall: number
  body: string
  leaseTerm: string
  status: 'published' | 'hidden' | 'removed'
  createdAt: string
  updatedAt: string
}

type ReviewRow = {
  id: string
  property_id: string
  property_slug: string
  author_id: string | null
  maintenance: number
  communication: number
  value: number
  overall: number
  body: string
  lease_term: string
  status: OwnedReview['status']
  created_at: Date
  updated_at: Date
}

const SELECT = `
  r.id, r.property_id, r.author_id, r.maintenance, r.communication, r.value,
  r.overall, r.body, r.lease_term, r.status, r.created_at, r.updated_at,
  p.slug as property_slug
`

function toReview(row: ReviewRow): OwnedReview {
  return {
    id: row.id,
    propertyId: row.property_id,
    propertySlug: row.property_slug,
    authorId: row.author_id,
    maintenance: row.maintenance,
    communication: row.communication,
    value: row.value,
    overall: row.overall,
    body: row.body,
    leaseTerm: row.lease_term,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

export async function createReview(
  db: Database,
  propertySlug: string,
  authorId: string,
  input: ReviewInput
): Promise<OwnedReview> {
  const { rows: properties } = await db.query('select id from properties where slug = $1', [
    propertySlug,
  ])
  const property = properties[0]
  if (!property) throw notFound(`No property with slug "${propertySlug}"`)

  try {
    const { rows } = await db.query(
      `with inserted as (
         insert into reviews
           (property_id, author_id, maintenance, communication, value, overall, body, lease_term)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning *
       )
       select ${SELECT} from inserted r join properties p on p.id = r.property_id`,
      [
        property.id,
        authorId,
        input.maintenance,
        input.communication,
        input.value,
        input.overall,
        input.body,
        input.leaseTerm,
      ]
    )
    return toReview(rows[0] as ReviewRow)
  } catch (error) {
    // The partial unique index allows one review per author per property,
    // excluding removed ones — so this means they already have a live review
    // here, not that they were once moderated.
    if (isUniqueViolation(error)) {
      throw conflict('You have already reviewed this property', 'already_reviewed')
    }
    throw error
  }
}

/**
 * Reads a review for an ownership decision. Removed reviews are reported as
 * absent: moderation has taken them out of circulation, and letting an author
 * keep editing one would work around that.
 */
export async function getReviewForAuthor(db: Database, id: string): Promise<OwnedReview | null> {
  const { rows } = await db.query(
    `select ${SELECT} from reviews r join properties p on p.id = r.property_id
     where r.id = $1 and r.status <> 'removed'`,
    [id]
  )
  return rows.length ? toReview(rows[0] as ReviewRow) : null
}

export async function updateReview(
  db: Database,
  id: string,
  current: OwnedReview,
  patch: ReviewPatch
): Promise<OwnedReview> {
  // Absent fields keep their current value, so a caller can send just the one
  // thing they changed rather than having to echo the whole review back.
  const next: ReviewInput = {
    maintenance: patch.maintenance ?? current.maintenance,
    communication: patch.communication ?? current.communication,
    value: patch.value ?? current.value,
    overall: patch.overall ?? current.overall,
    body: patch.body ?? current.body,
    leaseTerm: patch.leaseTerm ?? current.leaseTerm,
  }

  const { rows } = await db.query(
    `with updated as (
       update reviews
       set maintenance = $2, communication = $3, value = $4, overall = $5,
           body = $6, lease_term = $7
       where id = $1 and status <> 'removed'
       returning *
     )
     select ${SELECT} from updated r join properties p on p.id = r.property_id`,
    [id, next.maintenance, next.communication, next.value, next.overall, next.body, next.leaseTerm]
  )
  if (!rows.length) throw notFound('That review no longer exists')
  return toReview(rows[0] as ReviewRow)
}

export async function deleteReview(db: Database, id: string): Promise<void> {
  const { rowCount } = await db.query(
    `update reviews set status = 'removed' where id = $1 and status <> 'removed'`,
    [id]
  )
  if (!rowCount) throw notFound('That review no longer exists')
}

/** A person's own reviews, including ones moderation has hidden from others. */
export async function listReviewsByAuthor(db: Database, authorId: string): Promise<OwnedReview[]> {
  const { rows } = await db.query(
    `select ${SELECT} from reviews r join properties p on p.id = r.property_id
     where r.author_id = $1 and r.status <> 'removed'
     order by r.created_at desc`,
    [authorId]
  )
  return (rows as ReviewRow[]).map(toReview)
}
