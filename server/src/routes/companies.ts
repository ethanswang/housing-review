import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Database } from '../db.ts'
import { notFound } from '../errors.ts'
import {
  type CompanyDetail,
  getCompanyBySlug,
  listCompanies,
  listCompanyProperties,
} from '../repositories/companies.ts'
import { blankToUndefined, optionalPage, optionalPerPage, parse, slugSchema } from './query.ts'

const listQuerySchema = z.object({
  sort: z.preprocess(
    blankToUndefined,
    z.enum(['rating', 'name', 'properties', 'reviews']).optional()
  ),
  page: optionalPage,
  perPage: optionalPerPage(100),
})

const detailQuerySchema = z.object({
  page: optionalPage,
  perPage: optionalPerPage(100),
})

export async function companyRoutes(app: FastifyInstance, options: { db: Database }) {
  app.get('/companies', async (request) => {
    const query = parse(listQuerySchema, request.query)
    return listCompanies(options.db, {
      sort: query.sort ?? 'rating',
      page: query.page ?? 1,
      perPage: query.perPage ?? 24,
    })
  })

  // Annotated so the declared response contract is enforced by the compiler
  // rather than merely documented next to code that could drift from it.
  app.get('/companies/:slug', async (request): Promise<CompanyDetail> => {
    const { slug } = parse(z.object({ slug: slugSchema }), request.params)
    const company = await getCompanyBySlug(options.db, slug)
    if (!company) throw notFound(`No management company with slug "${slug}"`)

    const query = parse(detailQuerySchema, request.query)
    const properties = await listCompanyProperties(
      options.db,
      company.id,
      query.page ?? 1,
      query.perPage ?? 24
    )
    return { ...company, properties }
  })
}
