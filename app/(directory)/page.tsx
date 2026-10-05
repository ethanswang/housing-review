import Link from 'next/link'
import { FilterRail } from '@/components/FilterRail'
import { Pagination } from '@/components/Pagination'
import { PropertyRow } from '@/components/PropertyRow'
import { SearchBox } from '@/components/SearchBox'
import { buildQuery, hasActiveFilters, PAGE_SIZE, pageQuery, parseFilters, parsePage, type RawSearchParams } from '@/lib/filters'
import { getFilterOptions, listProperties } from '@/lib/queries'

// Reviews change whenever someone submits one, so the directory is rendered per
// request rather than prerendered at build time.
export const dynamic = 'force-dynamic'

export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  // In Next 16 `searchParams` is a promise — reading it is what marks the page dynamic.
  const params = await searchParams
  const filters = parseFilters(params)
  const page = parsePage(params)

  const [{ properties, total, totalPages }, options] = await Promise.all([
    listProperties(filters, page, PAGE_SIZE),
    getFilterOptions(),
  ])
  const first = (page - 1) * PAGE_SIZE + 1

  // "Clear filters" keeps the chosen sort, matching the rail's "Clear all".
  const clearedQuery = buildQuery({ sort: filters.sort })

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 md:px-6 md:pt-10">
      <section className="max-w-2xl">
        <h1 className="text-heading font-semibold text-balance md:text-display">
          Apartment reviews from Illinois students
        </h1>
        <p className="mt-2 text-body text-ink-soft">
          Every review is from a verified @illinois.edu student. Champaign–Urbana buildings, scored
          on maintenance, communication, and value.
        </p>

        <div className="mt-6">
          {/* Keyed so the input resets when a chip or "Clear all" drops the search. */}
          <SearchBox key={filters.search ?? ''} filters={filters} />
        </div>
      </section>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-x-12 lg:mt-10 lg:grid-cols-[15rem_minmax(0,45rem)]">
        <FilterRail filters={filters} options={options} resultCount={total} />

        <section aria-label="Results">
          <p className="border-b border-rule py-3 text-meta text-muted">
            {total > PAGE_SIZE && properties.length > 0 && `${first}–${first + properties.length - 1} of `}
            {total} {total === 1 ? 'property' : 'properties'}
            {filters.search && ` · matching “${filters.search}”`}
          </p>

          {properties.length === 0 && total > 0 ? (
            // A page past the end, from an old link or a hand-edited URL.
            <div className="py-12">
              <p className="text-title font-semibold">There is no page {page}.</p>
              <Link href={pageQuery(filters, 1) ? `/?${pageQuery(filters, 1)}` : '/'} className="mt-4 inline-flex h-11 items-center rounded-lg border border-rule-strong bg-surface px-4 text-body font-semibold">
                Back to the first page
              </Link>
            </div>
          ) : properties.length === 0 ? (
            <div className="py-12">
              <p className="text-title font-semibold">
                {hasActiveFilters(filters)
                  ? 'Nothing matches these filters.'
                  : 'No properties have been added yet.'}
              </p>
              {hasActiveFilters(filters) && (
                <>
                  <p className="mt-1 text-body text-ink-soft">
                    Try a higher rent limit or fewer areas.
                  </p>
                  <Link
                    href={clearedQuery ? `/?${clearedQuery}` : '/'}
                    scroll={false}
                    className="mt-4 inline-flex h-11 items-center rounded-lg border border-rule-strong bg-surface px-4 text-body font-semibold"
                  >
                    Clear filters
                  </Link>
                </>
              )}
            </div>
          ) : (
            <>
              <ul>
                {properties.map((property) => (
                  <PropertyRow key={property.id} property={property} />
                ))}
              </ul>
              <Pagination filters={filters} page={page} totalPages={totalPages} />
            </>
          )}
        </section>
      </div>
    </div>
  )
}
