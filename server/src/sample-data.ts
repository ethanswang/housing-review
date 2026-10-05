import type pg from 'pg'

/**
 * Removes the demonstration data the site launched with (supabase/seed.sql and
 * seeds/dev.sql), and nothing else:
 *
 *   - Reviews marked is_sample. Only the seed files set it; the API cannot, as
 *     the column is not granted to it (docs/DATABASE.md).
 *   - The eight sample buildings below, each only when both its slug and its
 *     "block of" address match exactly, it has no review left that is not a
 *     sample, and no public-data source is linked to it. Anything else with a
 *     sample building's slug is someone's real data and is reported, not touched.
 *
 * The seed's companies are real companies and stay. Dry run unless applied.
 */
export const SAMPLE_PROPERTIES = [
  { slug: 'here-champaign', address: '300 block of E Green St, Champaign' },
  { slug: 'green-street-towers', address: '500 block of E Green St, Champaign' },
  { slug: 'lofts-54', address: '50 block of E John St, Champaign' },
  { slug: 'bankier-apartments', address: '400 block of E Green St, Champaign' },
  { slug: 'roland-realty', address: '600 block of E Daniel St, Champaign' },
  { slug: 'green-street-realty', address: '100 block of N Neil St, Champaign' },
  { slug: 'smith-apartments', address: '900 block of W Green St, Urbana' },
  { slug: 'campus-circle', address: '200 block of E Springfield Ave' },
] as const

export type SampleCleanup = {
  applied: boolean
  sampleReviewsDeleted: number
  propertiesDeleted: string[]
  kept: { slug: string; reason: string }[]
}

export async function removeSampleData(client: pg.ClientBase, { apply }: { apply: boolean }): Promise<SampleCleanup> {
  const result: SampleCleanup = { applied: apply, sampleReviewsDeleted: 0, propertiesDeleted: [], kept: [] }
  await client.query('begin')
  try {
    const reviews = await client.query('delete from reviews where is_sample')
    result.sampleReviewsDeleted = reviews.rowCount ?? 0

    for (const sample of SAMPLE_PROPERTIES) {
      const { rows } = await client.query<{ id: string; address: string; real_reviews: number; sources: number }>(
        `select p.id, p.address,
                (select count(*)::int from reviews r where r.property_id = p.id) as real_reviews,
                (select count(*)::int from property_sources s where s.property_id = p.id) as sources
         from properties p where p.slug = $1
         for update of p`,
        [sample.slug]
      )
      const row = rows[0]
      if (!row) continue
      if (row.address !== sample.address) {
        result.kept.push({ slug: sample.slug, reason: `address is "${row.address}", not the sample's` })
      } else if (row.real_reviews > 0) {
        result.kept.push({ slug: sample.slug, reason: `has ${row.real_reviews} review(s) that are not samples` })
      } else if (row.sources > 0) {
        result.kept.push({ slug: sample.slug, reason: 'linked to a public-data source' })
      } else {
        await client.query('delete from properties where id = $1', [row.id])
        result.propertiesDeleted.push(sample.slug)
      }
    }
    await client.query(apply ? 'commit' : 'rollback')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}
