import Link from 'next/link'
import { notFound } from 'next/navigation'
import { RatingSummary } from '@/components/Ratings'
import { ReviewCard } from '@/components/ReviewCard'
import { ReviewForm } from '@/components/ReviewForm'
import { currentUser } from '@/lib/auth'
import { bedroomList } from '@/lib/format'
import { getPropertyBySlug } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export default async function PropertyPage({ params }: { params: Promise<{ slug: string }> }) {
  // `params` is a promise in Next 16; the slug is the URL segment, matched
  // against the `slug` column by getPropertyBySlug.
  const { slug } = await params
  const [property, user] = await Promise.all([getPropertyBySlug(slug), currentUser()])

  if (!property) notFound()

  const sampleCount = property.reviews.filter((r) => r.is_sample).length

  const hasReviews = property.reviewCount > 0

  return (
    <div className="mx-auto max-w-6xl px-4 pt-2 md:px-6 md:pt-6 lg:grid lg:grid-cols-[minmax(0,42rem)_20rem] lg:justify-between lg:gap-x-12">
      <header className="lg:col-start-1">
        <Link href="/" className="inline-flex h-11 items-center text-meta text-ink-soft hover:text-ink">
          ← All properties
        </Link>
        <h1 className="mt-2 text-heading font-semibold md:text-display">{property.name}</h1>
        <p className="mt-1 text-meta text-muted">{property.address}</p>
      </header>

      {/* Mobile: directly under the title so it lands above the fold.
          Desktop: a sticky column beside everything else. */}
      <aside
        id="summary"
        className="mt-6 border-y border-rule py-6 lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-8 lg:self-start lg:rounded-lg lg:border lg:bg-surface lg:p-6"
      >
        {hasReviews ? (
          <>
            <RatingSummary averages={property.averages} reviewCount={property.reviewCount} />
            <a
              href="#write-review"
              className="mt-6 flex h-11 w-full items-center justify-center rounded-lg border border-rule-strong bg-surface text-body font-semibold hover:border-ink"
            >
              Write a review
            </a>
          </>
        ) : (
          <>
            <p className="text-title font-semibold text-balance">No reviews yet — lived here? Be the first.</p>
            <p className="mt-1 text-meta text-muted">Takes about a minute. Sign in with your Illinois email.</p>
            <a
              href="#write-review"
              className="mt-4 flex h-12 w-full items-center justify-center rounded-lg bg-accent text-body font-semibold text-surface hover:bg-accent-dark"
            >
              Write the first review
            </a>
          </>
        )}
      </aside>

      <div className="lg:col-start-1">
        <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-rule bg-rule">
          <Fact label="Rent">
            <span className="tnum">
              ${property.rent_min.toLocaleString()}–{property.rent_max.toLocaleString()}/mo
            </span>
          </Fact>
          <Fact label="Bedrooms">{bedroomList(property.bedrooms)}</Fact>
          <Fact label="Area">{property.neighborhood}</Fact>
          {/* The link stretches over the whole cell so the tap target is the cell. */}
          <Fact label="Managed by">
            {property.company ? (
              <Link href={`/companies/${property.company.slug}`} className="text-accent underline underline-offset-2 after:absolute after:inset-0">
                {property.company.name}
              </Link>
            ) : (
              'Independent'
            )}
          </Fact>
        </dl>

        {hasReviews && (
          <section className="mt-10" aria-labelledby="reviews-heading">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id="reviews-heading" className="text-title font-semibold">
                {property.reviewCount} {property.reviewCount === 1 ? 'review' : 'reviews'}
              </h2>
              <p className="text-meta text-muted">Newest first</p>
            </div>
            {sampleCount > 0 && (
              <p className="mt-1 text-meta text-muted">
                {sampleCount} sample {sampleCount === 1 ? 'entry' : 'entries'} for demonstration
              </p>
            )}
            <div className="mt-4">
              {property.reviews.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
            </div>
          </section>
        )}

        <section id="write-review" className="mt-10 scroll-mt-4 border-t border-ink pt-6">
          <h2 className="text-title font-semibold">Write a review</h2>
          <p className="mt-1 text-meta text-muted">Posted anonymously · takes about a minute</p>
          <div className="mt-6">
            {user ? (
              <ReviewForm slug={property.slug} />
            ) : (
              <p className="text-body">
                <Link
                  href={`/signin?next=${encodeURIComponent(`/properties/${property.slug}#write-review`)}`}
                  className="font-semibold underline"
                >
                  Sign in with your @illinois.edu email
                </Link>{' '}
                to write a review. Your address is never shown with it.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="relative bg-bg px-4 py-3">
      <dt className="text-meta text-muted">{label}</dt>
      <dd className="text-body font-semibold">{children}</dd>
    </div>
  )
}
