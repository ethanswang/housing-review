import { FilterRail } from '@/components/FilterRail'
import { PropertyCard } from '@/components/PropertyCard'
import { SearchBox } from '@/components/SearchBox'
import { parseFilters, hasActiveFilters, type RawSearchParams } from '@/lib/filters'
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
  const filters = parseFilters(await searchParams)

  const [properties, options] = await Promise.all([listProperties(filters), getFilterOptions()])

  const totalReviews = properties.reduce((sum, p) => sum + p.reviewCount, 0)

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <section className="max-w-3xl">
        <h2 className="font-display text-4xl leading-[1.1] sm:text-5xl">
          Find out what it&rsquo;s actually like
          <span className="text-accent"> to live there.</span>
        </h2>
        <p className="mt-4 max-w-xl text-[0.9375rem] leading-relaxed text-ink-soft">
          Apartment reviews written by Illinois students, scored on the things that decide whether a
          lease was a mistake: maintenance, communication, and value.
        </p>
        <p className="mt-6 border-l-2 border-accent bg-accent-dim px-3 py-2 text-sm">
          <strong className="font-semibold">Prototype.</strong> Ratings below are computed from
          sample reviews written to demonstrate the site, not from real tenants.
        </p>

        <div className="mt-8">
          <SearchBox filters={filters} />
        </div>
      </section>

      <div className="mt-12 grid gap-10 lg:grid-cols-[15rem_1fr]">
        <div className="lg:sticky lg:top-8 lg:self-start">
          <FilterRail filters={filters} options={options} />
        </div>

        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule pb-2">
            <p className="label">
              {properties.length} {properties.length === 1 ? 'property' : 'properties'} ·{' '}
              {totalReviews} {totalReviews === 1 ? 'review' : 'reviews'}
            </p>
            {filters.search && <p className="label">Matching “{filters.search}”</p>}
          </div>

          {properties.length === 0 ? (
            <div className="border border-dashed border-rule px-6 py-16 text-center">
              <p className="font-display text-2xl">Nothing matches those filters.</p>
              <p className="mt-2 text-sm text-ink-soft">
                {hasActiveFilters(filters)
                  ? 'Try widening the price range or clearing a filter.'
                  : 'No properties have been added yet.'}
              </p>
            </div>
          ) : (
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {properties.map((property) => (
                <PropertyCard key={property.id} property={property} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
