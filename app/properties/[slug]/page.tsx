import Link from 'next/link'
import { notFound } from 'next/navigation'
import { RatingSummary } from '@/components/Ratings'
import { ReviewCard } from '@/components/ReviewCard'
import { ReviewForm } from '@/components/ReviewForm'
import { accessToken, currentUser } from '@/lib/auth'
import { bedroomList, rentRange, sizeLabel } from '@/lib/format'
import { getMyReview, getPropertyBySlug } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export default async function PropertyPage({ params }: { params: Promise<{ slug: string }> }) {
  // `params` is a promise in Next 16; the slug is the URL segment, matched
  // against the `slug` column by getPropertyBySlug.
  const { slug } = await params
  const [property, user] = await Promise.all([getPropertyBySlug(slug), currentUser()])

  if (!property) notFound()

  // One review per student per building: someone who has one sees it
  // acknowledged instead of a form the API would refuse.
  const token = user ? await accessToken() : null
  const myReview = token ? await getMyReview(property.slug, token) : null

  const sampleCount = property.reviews.filter((r) => r.is_sample).length

  const hasReviews = property.reviewCount > 0

  // The facts the site knows, and a single line naming what it does not, rather
  // than a grid of "not listed".
  const rent = rentRange(property.rent_min, property.rent_max, property.rent_basis)
  const size = sizeLabel(property.unit_count, property.stories)
  const known: [string, React.ReactNode | null][] = [
    ['Rent', rent && <span className="tnum">{rent}</span>],
    ['Bedrooms', property.bedrooms.length ? bedroomList(property.bedrooms) : null],
    ['Size', size && <span className="tnum">{size}</span>],
    ['Area', property.neighborhood],
    [
      'Website',
      property.website && (
        // Stretched over the cell like the company link; opens the building's
        // own site without telling it which page sent the visitor.
        <a
          href={property.website}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline underline-offset-2 after:absolute after:inset-0"
        >
          {URL.canParse(property.website) ? new URL(property.website).hostname.replace(/^www\./, '') : property.website}
        </a>
      ),
    ],
    [
      'Managed by',
      property.company && (
        // The link stretches over the whole cell so the tap target is the cell.
        <Link href={`/companies/${property.company.slug}`} className="text-accent underline underline-offset-2 after:absolute after:inset-0">
          {property.company.name}
        </Link>
      ),
    ],
  ]
  const facts = known.filter(([, value]) => value)
  const missing = [
    !rent && 'Rent',
    !property.bedrooms.length && 'bedrooms',
    !property.company && 'the management company',
  ].filter((x): x is string => Boolean(x))

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
            {!myReview && (
              <a
                href="#write-review"
                className="mt-6 flex h-11 w-full items-center justify-center rounded-lg border border-rule-strong bg-surface text-body font-semibold hover:border-ink"
              >
                Write a review
              </a>
            )}
          </>
        ) : myReview ? (
          // Their review exists but is not shown: a moderator has hidden it.
          <p className="text-title font-semibold text-balance">No published reviews yet.</p>
        ) : (
          <>
            <p className="text-title font-semibold text-balance">No reviews yet.</p>
            {!user && <p className="mt-1 text-meta text-muted">Sign in with your Illinois email to add one.</p>}
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
        {facts.length > 0 && (
          <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-rule bg-rule [&>:last-child:nth-child(odd)]:col-span-2">
            {facts.map(([label, value]) => (
              <Fact key={label} label={label}>
                {value}
              </Fact>
            ))}
          </dl>
        )}
        {rent && (
          <p className="mt-3 text-meta text-muted">
            Rent is as listed by the building or rental sites and may be out of date. Check the building&rsquo;s own
            site for current prices and fees.
          </p>
        )}
        {missing.length > 0 && (
          <p className="mt-3 text-meta text-muted">
            {sentence(missing)} {missing.length === 1 ? 'is' : 'are'} not listed for this building yet.
          </p>
        )}

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
                <ReviewCard
                  key={review.id}
                  review={review}
                  report={{ signedIn: Boolean(user), signInHref: `/signin?next=${encodeURIComponent(`/properties/${property.slug}#reviews-heading`)}` }}
                />
              ))}
            </div>
          </section>
        )}

        <section id="write-review" className="mt-10 scroll-mt-4 border-t border-ink pt-6">
          <h2 className="text-title font-semibold">{myReview ? 'Your review' : 'Write a review'}</h2>
          {!myReview && <p className="mt-1 text-meta text-muted">Posted anonymously</p>}
          <div className="mt-6">
            {myReview ? (
              <div role="status">
                <p className="text-body font-semibold">You have reviewed this building.</p>
                <p className="mt-1 text-body text-ink-soft">
                  {myReview.status === 'hidden'
                    ? 'A moderator hid your review after it was reported, so it is not shown to others.'
                    : 'It is shown with the other reviews above. Each student can review a building once.'}
                </p>
              </div>
            ) : user ? (
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

/** "Rent", "Rent and bedrooms", "Rent, bedrooms and the management company". */
function sentence(items: string[]): string {
  const text = items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : (items[0] ?? '')
  return text.charAt(0).toUpperCase() + text.slice(1)
}
