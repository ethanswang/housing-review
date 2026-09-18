import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { currentUser } from '../auth/plugin.ts'
import type { Database } from '../db.ts'
import { forbidden, notFound } from '../errors.ts'
import {
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

const reviewBodySchema = z.object({
  maintenance: rating,
  communication: rating,
  value: rating,
  overall: rating,
  body: z.string().trim().min(20, 'must be at least 20 characters').max(2000),
  leaseTerm: z.string().trim().min(1).max(40),
})

const idSchema = z.object({ id: z.uuid('must be a review id') })

export async function reviewRoutes(
  app: FastifyInstance,
  options: { db: Database; config: Config }
) {
  // After requireAuth, so the bucket is the account rather than the network.
  const limited = [app.requireAuth, createWriteLimiter(options.config)]

  app.post('/properties/:slug/reviews', { preHandler: limited }, async (request, reply) => {
    const { slug } = parse(z.object({ slug: slugSchema }), request.params)
    const input = parse(reviewBodySchema, request.body)
    const review = await createReview(options.db, slug, currentUser(request).id, input)
    return reply.status(201).send(review)
  })

  app.patch('/reviews/:id', { preHandler: limited }, async (request) => {
    const { id } = parse(idSchema, request.params)
    const input = parse(reviewBodySchema, request.body)
    await assertOwned(options.db, id, currentUser(request).id)
    return updateReview(options.db, id, input)
  })

  app.delete('/reviews/:id', { preHandler: limited }, async (request, reply) => {
    const { id } = parse(idSchema, request.params)
    await assertOwned(options.db, id, currentUser(request).id)
    await deleteReview(options.db, id)
    return reply.status(204).send()
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
async function assertOwned(db: Database, reviewId: string, userId: string): Promise<void> {
  const review = await getReviewForAuthor(db, reviewId)
  if (!review) throw notFound('That review no longer exists')
  if (review.authorId !== userId) {
    throw forbidden('You can only change your own reviews')
  }
}
