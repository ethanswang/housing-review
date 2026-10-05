import type pg from 'pg'
import { z } from 'zod'
import { normalizeCompanyName } from './ingest/address.ts'

/**
 * Loads the list of management companies and properties into the database.
 *
 * Built for production, so it is the opposite of the dev seed in every way
 * that matters:
 *
 *   - It never deletes. A row missing from the file is left alone; removing a
 *     property is a deliberate, separate act, because its reviews go with it.
 *   - It is keyed by slug, so running the same file twice changes nothing, and
 *     running a corrected file updates exactly the rows that changed.
 *   - The whole file is validated before anything is written, and the writes
 *     share one transaction, so a bad file leaves the database as it was.
 *   - Without `apply` the transaction is rolled back, so the default run is a
 *     dry run that reports what would happen.
 */

const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase slug like "green-street-towers"')
  .max(200)

// Mirrors the table constraints, so a bad row is reported by name here rather
// than as a constraint violation halfway through the transaction.
const companySchema = z.object({
  slug,
  name: z.string().trim().min(1).max(120),
  // http(s) only. z.url() alone accepts `javascript:alert(1)`, which becomes a
  // script the moment any page renders the website as a link.
  website: z.url({ protocol: /^https?$/, error: 'must be an http:// or https:// URL' }).optional(),
  // Other spellings public data uses for this company ("Green Streeet Realty"),
  // so the property importer recognises them. Added or re-pointed, never removed.
  aliases: z.array(z.string().trim().min(1).max(120)).optional(),
})

const propertySchema = z
  .object({
    slug,
    name: z.string().trim().min(1).max(120),
    address: z.string().trim().min(1),
    neighborhood: z.string().trim().min(1),
    rentMin: z.number().int().positive(),
    rentMax: z.number().int().positive(),
    // Sorted and de-duplicated, so [2, 1] and [1, 2] compare equal and a
    // reordered file does not report every property as changed.
    bedrooms: z
      .array(z.number().int().min(0).max(20))
      .transform((sizes) => [...new Set(sizes)].sort((a, b) => a - b)),
    // A company slug from this file or already in the database; null when the
    // company is not known.
    company: slug.nullable(),
  })
  .refine((p) => p.rentMax >= p.rentMin, { message: 'rentMax must be at least rentMin', path: ['rentMax'] })

export const catalogSchema = z
  .object({
    companies: z.array(companySchema),
    properties: z.array(propertySchema),
  })
  .superRefine((catalog, ctx) => {
    // Two rows with one slug would silently collapse into whichever came last.
    for (const key of ['companies', 'properties'] as const) {
      const seen = new Set<string>()
      catalog[key].forEach((row, index) => {
        if (seen.has(row.slug)) {
          ctx.addIssue({ code: 'custom', path: [key, index, 'slug'], message: `duplicate slug "${row.slug}"` })
        }
        seen.add(row.slug)
      })
    }
  })

export type Catalog = z.infer<typeof catalogSchema>

export type ImportCounts = { inserted: number; updated: number; unchanged: number }
export type ImportResult = { applied: boolean; companies: ImportCounts; properties: ImportCounts }

/** Parses and validates, naming every problem at once rather than the first. */
export function parseCatalog(input: unknown): Catalog {
  const result = catalogSchema.safeParse(input)
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid catalog:\n${detail}`)
  }
  return result.data
}

export async function importCatalog(
  client: pg.ClientBase,
  catalog: Catalog,
  { apply }: { apply: boolean }
): Promise<ImportResult> {
  await client.query('begin')
  try {
    const companies = await upsertCompanies(client, catalog.companies)
    const properties = await upsertProperties(client, catalog.properties)
    await client.query(apply ? 'commit' : 'rollback')
    return { applied: apply, companies, properties }
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

/**
 * Existing slugs are read first so that an insert and an update can be told
 * apart; the upsert then returns only rows it inserted or actually changed,
 * because the `where` on `do update` skips rows whose values already match.
 */
async function existingSlugs(client: pg.ClientBase, table: string, slugs: string[]) {
  const { rows } = await client.query<{ slug: string }>(
    `select slug from ${table} where slug = any($1::text[])`,
    [slugs]
  )
  return new Set(rows.map((row) => row.slug))
}

function count(total: number, written: string[], existed: Set<string>): ImportCounts {
  const inserted = written.filter((s) => !existed.has(s)).length
  const updated = written.length - inserted
  return { inserted, updated, unchanged: total - written.length }
}

async function upsertCompanies(client: pg.ClientBase, companies: Catalog['companies']) {
  const existed = await existingSlugs(client, 'management_companies', companies.map((c) => c.slug))
  const written: string[] = []
  for (const company of companies) {
    const { rows } = await client.query<{ slug: string }>(
      `insert into management_companies (slug, name, website)
       values ($1, $2, $3)
       on conflict (slug) do update
         set name = excluded.name, website = excluded.website
         where (management_companies.name, management_companies.website)
               is distinct from (excluded.name, excluded.website)
       returning slug`,
      [company.slug, company.name, company.website ?? null]
    )
    if (rows[0]) written.push(rows[0].slug)
  }
  for (const company of companies) {
    for (const alias of company.aliases ?? []) {
      await client.query(
        `insert into management_company_aliases (alias_normalized, alias, company_id)
         select $1, $2, id from management_companies where slug = $3
         on conflict (alias_normalized) do update set alias = excluded.alias, company_id = excluded.company_id`,
        [normalizeCompanyName(alias), alias, company.slug]
      )
    }
  }
  return count(companies.length, written, existed)
}

async function upsertProperties(client: pg.ClientBase, properties: Catalog['properties']) {
  // Resolved after the companies are written, so a property may name a
  // company introduced by the same file.
  const companySlugs = [...new Set(properties.flatMap((p) => (p.company ? [p.company] : [])))]
  const { rows: found } = await client.query<{ id: string; slug: string }>(
    'select id, slug from management_companies where slug = any($1::text[])',
    [companySlugs]
  )
  const companyIds = new Map(found.map((row) => [row.slug, row.id]))
  const missing = companySlugs.filter((s) => !companyIds.has(s))
  if (missing.length) {
    throw new Error(`Unknown company slug(s), not in the file or the database: ${missing.join(', ')}`)
  }

  const existed = await existingSlugs(client, 'properties', properties.map((p) => p.slug))
  const written: string[] = []
  for (const p of properties) {
    const companyId = p.company ? companyIds.get(p.company)! : null
    const { rows } = await client.query<{ slug: string }>(
      `insert into properties
         (slug, name, address, neighborhood, rent_min, rent_max, bedrooms, company_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (slug) do update
         set name = excluded.name, address = excluded.address,
             neighborhood = excluded.neighborhood, rent_min = excluded.rent_min,
             rent_max = excluded.rent_max, bedrooms = excluded.bedrooms,
             company_id = excluded.company_id
         where (properties.name, properties.address, properties.neighborhood,
                properties.rent_min, properties.rent_max, properties.bedrooms,
                properties.company_id)
               is distinct from
               (excluded.name, excluded.address, excluded.neighborhood,
                excluded.rent_min, excluded.rent_max, excluded.bedrooms,
                excluded.company_id)
       returning slug`,
      [p.slug, p.name, p.address, p.neighborhood, p.rentMin, p.rentMax, p.bedrooms, companyId]
    )
    if (rows[0]) written.push(rows[0].slug)
  }
  return count(properties.length, written, existed)
}
