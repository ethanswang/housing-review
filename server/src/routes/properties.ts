import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Database } from '../db.ts'
import { badRequest, notFound } from '../errors.ts'
import {
  getPropertyBySlug,
  listProperties,
  listReviewsForProperty,
} from '../repositories/properties.ts'

/**
 * Query parsing has to tolerate what real clients send, not only what a
 * well-behaved one sends. Two shapes matter:
 *
 *   ?q=                        a form submitted with an empty search box
 *   ?company=a&company=b       the standard repeated-key multi-value form
 *
 * The first must mean "no filter", not an error page. The second arrives from
 * Fastify as an array.
 */
const blankToUndefined = (value: unknown) =>
  value === '' || (Array.isArray(value) && value.length === 0) ? undefined : value

/** Accepts repeated keys, comma-separated values, or both. */
const stringList = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => {
    const parts = (Array.isArray(value) ? value : [value])
      .flatMap((part) => part.split(','))
      .map((part) => part.trim())
      .filter(Boolean)
    return parts.length ? parts : undefined
  })

const searchTerm = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => (Array.isArray(value) ? (value[0] ?? '') : value).trim())
  .refine((value) => value.length <= 100, 'must be at most 100 characters')
  .transform((value) => (value.length ? value : undefined))

const bedroomList = stringList.refine(
  (values) =>
    values === undefined ||
    values.every((value) => /^\d+$/.test(value) && Number(value) <= 20),
  'bedroom counts must be whole numbers between 0 and 20'
)

const listQuerySchema = z.object({
  q: searchTerm.optional(),
  company: stringList.optional(),
  hood: stringList.optional(),
  beds: bedroomList.optional(),
  // .optional() goes *inside* the preprocess, not outside it. An outer optional
  // tests the raw input: for `?page=` that is '', which is not undefined, so it
  // never short-circuits, and the inner schema then receives the preprocessed
  // undefined and coerces it to NaN.
  maxRent: z.preprocess(blankToUndefined, z.coerce.number().int().positive().max(100_000).optional()),
  sort: z.preprocess(blankToUndefined, z.enum(['rating', 'price', 'reviews']).optional()),
  page: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(10_000).optional()),
  // Capped so a single request cannot ask for the entire table.
  perPage: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(100).optional()),
})

const reviewQuerySchema = z.object({
  page: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(10_000).optional()),
  perPage: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(100).optional()),
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
      bedrooms: query.beds?.map(Number),
      sort: query.sort ?? 'rating',
      page: query.page ?? 1,
      perPage: query.perPage ?? 24,
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
      query.page ?? 1,
      query.perPage ?? 20
    )
    return { ...property, reviews }
  })
}
