import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { currentUser } from '../auth/plugin.ts'
import type { Database } from '../db.ts'
import { forbidden, notFound } from '../errors.ts'
import type { OwnedReview } from '../repositories/reviews.ts'
import {
  createReport,
  createReview,
  deleteReview,
  getReviewForAuthor,
  listReviewsByAuthor,
  updateReview,
} from '../repositories/reviews.ts'
import type { Config } from '../config.ts'
import { createWriteLimiter } from '../rate-limit.ts'
import { parse, slugSchema } from './query.ts'

/**
 * Mirrors the database constraints exactly. Both layers are deliberate: this
 * one produces a usable message, the schema is the guarantee that holds even
 * if this code is wrong or bypassed.
 */
const rating = z.number().int().min(1).max(5)

const reviewFields = {
  maintenance: rating,
  communication: rating,
  value: rating,
  overall: rating,
  body: z.string().trim().min(20, 'must be at least 20 characters').max(2000),
  leaseTerm: z.string().trim().min(1).max(40),
}

/** Creating one needs the whole thing. */
const reviewBodySchema = z.object(reviewFields)

/**
 * Patching it does not. PATCH means "change these fields", so requiring the
 * full body would make it a replacement wearing the wrong verb — and would
 * force a client that wants to fix a typo to echo back four ratings it never
 * touched.
 */
const reviewPatchSchema = z
  .object(reviewFields)
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'must change at least one field')

const idSchema = z.object({ id: z.uuid('must be a review id') })

/** Mirrors the review_reports reason and details constraints. */
const reportBodySchema = z.object({
  reason: z.enum(['spam', 'harassment', 'not_a_tenant', 'personal_info', 'other']),
  details: z
    .string()
    .trim()
    .max(1000)
    .transform((value) => (value.length ? value : undefined))
    .optional(),
})

export async function reviewRoutes(
  app: FastifyInstance,
  options: { db: Database; config: Config }
) {
  // After requireAuth, so the budget belongs to the account rather than to
  // whatever network it happens to be on. `check` refuses an account that is
  // over its ceiling; `record` spends the budget only once a write succeeded.
  const writeLimiter = createWriteLimiter(options.config)
  const limited = [app.requireAuth, writeLimiter.check]
  const countWrite = writeLimiter.record

  app.post('/properties/:slug/reviews', { preHandler: limited, onResponse: countWrite }, async (request, reply) => {
    const { slug } = parse(z.object({ slug: slugSchema }), request.params)
    const input = parse(reviewBodySchema, request.body)
    const review = await createReview(options.db, slug, currentUser(request).id, input)
    return reply.status(201).send(review)
  })

  app.patch('/reviews/:id', { preHandler: limited, onResponse: countWrite }, async (request) => {
    const { id } = parse(idSchema, request.params)
    const patch = parse(reviewPatchSchema, request.body)
    const current = await assertOwned(options.db, id, currentUser(request).id)
    return updateReview(options.db, id, current, patch)
  })

  app.delete('/reviews/:id', { preHandler: limited, onResponse: countWrite }, async (request, reply) => {
    const { id } = parse(idSchema, request.params)
    await assertOwned(options.db, id, currentUser(request).id)
    await deleteReview(options.db, id)
    return reply.status(204).send()
  })

  // Shares the write budget with reviews: filing reports is a write, and a
  // separate budget would double what one account can push into the queue.
  app.post('/reviews/:id/reports', { preHandler: limited, onResponse: countWrite }, async (request, reply) => {
    const { id } = parse(idSchema, request.params)
    const input = parse(reportBodySchema, request.body)
    const report = await createReport(options.db, id, currentUser(request).id, input)
    return reply.status(201).send(report)
  })

  app.get('/me/reviews', { preHandler: app.requireAuth }, async (request) =>
    listReviewsByAuthor(options.db, currentUser(request).id)
  )
}

/**
 * The only thing standing between a signed-in user and someone else's review.
 * It runs on every write, reads the owner from the database rather than from
 * the request, and never consults what the client claims.
 *
 * A review with no author — seeded rows, and anything written before accounts
 * existed — can therefore be edited by nobody, since null matches no user id.
 */
async function assertOwned(
  db: Database,
  reviewId: string,
  userId: string
): Promise<OwnedReview> {
  const review = await getReviewForAuthor(db, reviewId)
  if (!review) throw notFound('That review no longer exists')
  if (review.authorId !== userId) {
    throw forbidden('You can only change your own reviews')
  }
  return review
}
