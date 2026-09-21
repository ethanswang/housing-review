import Link from 'next/link'
import { notFound } from 'next/navigation'
import { RatingBars, ScoreNumeral } from '@/components/Ratings'
import { ReviewCard } from '@/components/ReviewCard'
import { ReviewForm } from '@/components/ReviewForm'
import { getPropertyBySlug } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export default async function PropertyPage({ params }: { params: Promise<{ slug: string }> }) {
  // `params` is a promise in Next 16; the slug is the URL segment, matched
  // against the `slug` column by getPropertyBySlug.
  const { slug } = await params
  const property = await getPropertyBySlug(slug)

  if (!property) notFound()

  const sampleCount = property.reviews.filter((r) => r.is_sample).length

  return (
    <div className="mx-auto max-w-4xl px-5 py-10">
      <Link href="/" className="label hover:text-accent">
        ← All properties
      </Link>

      <header className="mt-6 flex flex-wrap items-start justify-between gap-6 border-b-2 border-ink pb-6">
        <div>
          <h2 className="font-display text-4xl leading-tight sm:text-5xl">{property.name}</h2>
          <p className="label mt-2">
            {property.company ? (
              <Link href={`/companies/${property.company.slug}`} className="hover:text-accent">
                {property.company.name}
              </Link>
            ) : (
              'Independent'
            )}{' '}
            · {property.neighborhood}
          </p>
          <p className="mt-3 text-sm text-ink-soft">{property.address}</p>
          <p className="tnum mt-1 text-xs text-ink-soft">
            ${property.rent_min.toLocaleString()}–{property.rent_max.toLocaleString()}/mo ·{' '}
            {property.bedrooms.join(', ')} BR
          </p>
        </div>

        <div className="text-right">
          <ScoreNumeral score={property.averages.overall} size="lg" />
          <p className="label mt-1">
            {property.reviewCount} {property.reviewCount === 1 ? 'review' : 'reviews'}
          </p>
        </div>
      </header>

      {property.reviewCount > 0 && (
        <section className="mt-8 max-w-lg">
          <RatingBars averages={property.averages} />
        </section>
      )}

      <section className="mt-14">
        <h3 className="font-display text-2xl">Write a review</h3>
        <p className="mt-2 text-sm text-ink-soft">No account needed. Takes about a minute.</p>
        <div className="mt-6">
          <ReviewForm propertyId={property.id} slug={property.slug} />
        </div>
      </section>

      <section className="mt-16">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-2xl">
            {property.reviewCount} {property.reviewCount === 1 ? 'review' : 'reviews'}
          </h3>
          {sampleCount > 0 && (
            <p className="label">
              {sampleCount} sample {sampleCount === 1 ? 'entry' : 'entries'} for demonstration
            </p>
          )}
        </div>

        {property.reviews.length === 0 ? (
          <p className="mt-6 border border-dashed border-rule px-6 py-12 text-center text-sm text-ink-soft">
            No reviews yet. Yours would be the first.
          </p>
        ) : (
          <div className="mt-2">
            {property.reviews.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
