import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Database } from '../db.ts'
import { badRequest, notFound } from '../errors.ts'
import {
  getPropertyBySlug,
  listProperties,
  listReviewsForProperty,
} from '../repositories/properties.ts'

/** Multi-value parameters are comma separated: ?company=jsm,roland-realty */
const commaList = z
  .string()
  .transform((value) => value.split(',').map((part) => part.trim()).filter(Boolean))

const listQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  company: commaList.optional(),
  hood: commaList.optional(),
  maxRent: z.coerce.number().int().positive().max(100_000).optional(),
  // Split and convert in one transform: piping a string[] into z.coerce.number()
  // does not typecheck, because coercion accepts unknown rather than string.
  beds: z
    .string()
    .transform((value) =>
      value.split(',').map((part) => part.trim()).filter(Boolean).map(Number)
    )
    .refine(
      (values) => values.every((n) => Number.isInteger(n) && n >= 0 && n <= 20),
      'bedroom counts must be whole numbers between 0 and 20'
    )
    .optional(),
  sort: z.enum(['rating', 'price', 'reviews']).default('rating'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  // Capped so a single request cannot ask for the entire table.
  perPage: z.coerce.number().int().min(1).max(100).default(24),
})

const reviewQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
})

const slugSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9-]+$/, 'must be a lowercase slug')

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`)
      .join('; ')
    throw badRequest(detail, 'validation_failed')
  }
  return result.data
}

export async function propertyRoutes(app: FastifyInstance, options: { db: Database }) {
  app.get('/properties', async (request) => {
    const query = parse(listQuerySchema, request.query)
    return listProperties(options.db, {
      search: query.q,
      companies: query.company,
      neighborhoods: query.hood,
      maxRent: query.maxRent,
      bedrooms: query.beds,
      sort: query.sort,
      page: query.page,
      perPage: query.perPage,
    })
  })

  app.get('/properties/:slug', async (request) => {
    const { slug } = parse(z.object({ slug: slugSchema }), request.params)
    const property = await getPropertyBySlug(options.db, slug)
    if (!property) throw notFound(`No property with slug "${slug}"`)

    const query = parse(reviewQuerySchema, request.query)
    const reviews = await listReviewsForProperty(
      options.db,
      property.id,
      query.page,
      query.perPage
    )
    return { ...property, reviews }
  })
}
