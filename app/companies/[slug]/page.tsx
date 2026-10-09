import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PropertyRow } from '@/components/PropertyRow'
import { RatingSummary } from '@/components/Ratings'
import { getCompanyBySlug } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export default async function CompanyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const company = await getCompanyBySlug(slug)

  if (!company) notFound()

  return (
    <div className="mx-auto max-w-6xl px-4 pt-2 md:px-6 md:pt-6 lg:grid lg:grid-cols-[minmax(0,42rem)_20rem] lg:justify-between lg:gap-x-12">
      <header className="lg:col-start-1">
        <Link href="/" className="inline-flex h-11 items-center text-meta text-ink-soft hover:text-ink">
          ← All properties
        </Link>
        <p className="mt-2 text-meta text-muted">Management company</p>
        <h1 className="text-heading font-semibold md:text-display">{company.name}</h1>
      </header>

      <aside className="mt-6 border-y border-rule py-6 lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-8 lg:self-start lg:border lg:bg-surface lg:p-6">
        {company.reviewCount > 0 ? (
          <>
            <RatingSummary averages={company.averages} reviewCount={company.reviewCount} />
            <p className="mt-4 text-meta text-muted">
              Averaged across this company&rsquo;s properties, weighted by review count. Experiences
              with management can vary building to building.
            </p>
          </>
        ) : (
          <p className="text-title font-semibold">No reviews yet for this company.</p>
        )}
      </aside>

      <section className="mt-10 lg:col-start-1" aria-labelledby="properties-heading">
        <h2 id="properties-heading" className="border-b border-rule pb-3 text-title font-semibold">
          {company.properties.length}{' '}
          {company.properties.length === 1 ? 'property' : 'properties'}
        </h2>
        <ul>
          {company.properties.map((property) => (
            <PropertyRow key={property.id} property={property} headingLevel={3} />
          ))}
        </ul>
      </section>
    </div>
  )
}
