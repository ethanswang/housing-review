import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Database } from '../db.ts'
import { notFound } from '../errors.ts'
import {
  getFilterOptions,
  getPropertyBySlug,
  listProperties,
  listReviewsForProperty,
} from '../repositories/properties.ts'
import {
  blankToUndefined,
  optionalPage,
  optionalPerPage,
  parse,
  searchTerm,
  slugSchema,
  stringList,
} from './query.ts'

const bedroomList = stringList.refine(
  (values) =>
    values === undefined || values.every((value) => /^\d+$/.test(value) && Number(value) <= 20),
  'bedroom counts must be whole numbers between 0 and 20'
)

const listQuerySchema = z.object({
  q: searchTerm.optional(),
  company: stringList.optional(),
  hood: stringList.optional(),
  beds: bedroomList.optional(),
  maxRent: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().positive().max(100_000).optional()
  ),
  sort: z.preprocess(blankToUndefined, z.enum(['rating', 'price', 'reviews']).optional()),
  page: optionalPage,
  // Capped so a single request cannot ask for the entire table.
  perPage: optionalPerPage(100),
})

const reviewQuerySchema = z.object({
  page: optionalPage,
  perPage: optionalPerPage(100),
})

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

  app.get('/filters', async () => getFilterOptions(options.db))

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
