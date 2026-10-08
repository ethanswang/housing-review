import type pg from 'pg'

/**
 * What a moderator does, as plain queries run by the operator tool
 * (src/moderate.ts, infra/moderate.sh) with the master login. The API cannot:
 * its role may not change a review's status except an author withdrawing their
 * own (docs/DATABASE.md), so a hijacked API cannot hide or publish reviews.
 *
 * Reviews go live without approval. Reports queue them for a person; nothing
 * here runs on its own. Every change is one transaction, rolled back unless
 * applied.
 */

export type ReportedReview = {
  reviewId: string
  status: string
  property: string
  propertySlug: string
  overall: number
  body: string
  postedAt: Date
  reports: number
  reasons: string[]
  details: string[]
  firstReportedAt: Date
}

/** Reviews with open reports, oldest report first. */
export async function listReported(client: pg.ClientBase): Promise<ReportedReview[]> {
  const { rows } = await client.query(
    `select r.id as "reviewId", r.status, p.name as property, p.slug as "propertySlug", r.overall, r.body,
            r.created_at as "postedAt", count(*)::int as reports,
            array_agg(rr.reason order by rr.created_at) as reasons,
            array_remove(array_agg(rr.details order by rr.created_at), null) as details,
            min(rr.created_at) as "firstReportedAt"
     from review_reports rr
     join reviews r on r.id = rr.review_id
     join properties p on p.id = r.property_id
     where rr.status = 'open'
     group by r.id, p.name, p.slug
     order by min(rr.created_at)`
  )
  return rows
}

export type RecentReview = { reviewId: string; status: string; property: string; overall: number; body: string; postedAt: Date }

/** The newest reviews, whatever their status, to look over what went live. */
export async function listRecent(client: pg.ClientBase, limit: number): Promise<RecentReview[]> {
  const { rows } = await client.query(
    `select r.id as "reviewId", r.status, p.name as property, r.overall, r.body, r.created_at as "postedAt"
     from reviews r join properties p on p.id = r.property_id
     where not r.is_sample
     order by r.created_at desc limit $1`,
    [limit]
  )
  return rows
}

export type ModerationResult = { applied: boolean; review: 'changed' | 'unchanged'; reportsClosed: number }

type Action = 'hide' | 'restore' | 'dismiss'

/**
 * hide:    published → hidden, and its open reports → actioned.
 * restore: hidden → published. Reports stay as they were.
 * dismiss: its open reports → dismissed; the review stays as it is.
 *
 * A removed review (withdrawn by its author) is never touched.
 */
export async function moderate(
  client: pg.ClientBase,
  action: Action,
  reviewId: string,
  { apply }: { apply: boolean }
): Promise<ModerationResult> {
  await client.query('begin')
  try {
    const { rows } = await client.query<{ status: string }>('select status from reviews where id = $1 for update', [reviewId])
    if (!rows[0]) throw new Error(`No review ${reviewId}`)

    let review: ModerationResult['review'] = 'unchanged'
    let reportsClosed = 0
    if (action === 'hide' || action === 'restore') {
      const [from, to] = action === 'hide' ? ['published', 'hidden'] : ['hidden', 'published']
      const updated = await client.query(
        `update reviews set status = $3, updated_at = now() where id = $1 and status = $2`,
        [reviewId, from, to]
      )
      if (updated.rowCount) review = 'changed'
      else if (rows[0].status !== to) throw new Error(`Review ${reviewId} is ${rows[0].status}, so it cannot be ${action === 'hide' ? 'hidden' : 'restored'}`)
    }
    if (action === 'hide' || action === 'dismiss') {
      const closed = await client.query(
        `update review_reports set status = $2, resolved_at = now() where review_id = $1 and status = 'open'`,
        [reviewId, action === 'hide' ? 'actioned' : 'dismissed']
      )
      reportsClosed = closed.rowCount ?? 0
    }
    await client.query(apply ? 'commit' : 'rollback')
    return { applied: apply, review, reportsClosed }
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}
