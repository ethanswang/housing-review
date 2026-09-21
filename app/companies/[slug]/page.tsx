import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PropertyCard } from '@/components/PropertyCard'
import { RatingBars, ScoreNumeral } from '@/components/Ratings'
import { getCompanyBySlug } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export default async function CompanyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const company = await getCompanyBySlug(slug)

  if (!company) notFound()

  return (
    <div className="mx-auto max-w-4xl px-5 py-10">
      <Link href="/" className="label hover:text-accent">
        ← All properties
      </Link>

      <header className="mt-6 flex flex-wrap items-start justify-between gap-6 border-b-2 border-ink pb-6">
        <div>
          <p className="label">Management company</p>
          <h2 className="mt-1 text-4xl leading-tight sm:text-5xl">{company.name}</h2>
          <p className="mt-3 text-sm text-ink-soft">
            {company.properties.length}{' '}
            {company.properties.length === 1 ? 'property' : 'properties'} listed
          </p>
        </div>

        <div className="text-right">
          <ScoreNumeral score={company.averages.overall} size="lg" />
          <p className="label mt-1">
            {company.reviewCount} {company.reviewCount === 1 ? 'review' : 'reviews'}
          </p>
        </div>
      </header>

      {company.reviewCount > 0 && (
        <section className="mt-8 max-w-lg">
          <RatingBars averages={company.averages} />
          <p className="mt-4 max-w-md text-xs leading-relaxed text-muted">
            Averaged across this company&rsquo;s properties, weighted by review count. Experiences
            with management can vary building to building.
          </p>
        </section>
      )}

      <section className="mt-14">
        <h3 className="text-2xl">Properties</h3>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {company.properties.map((property) => (
            <PropertyCard key={property.id} property={property} />
          ))}
        </div>
      </section>
    </div>
  )
}
