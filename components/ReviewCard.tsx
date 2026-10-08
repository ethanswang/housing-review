import type { Review } from '@/lib/types'
import { SampleBadge, SubRatingsInline } from './Ratings'
import { ReportReview } from './ReportReview'

/** "Mar 2025". Fixed time zone so the month doesn't depend on the server's locale. */
function postedMonth(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Chicago',
  })
}

/**
 * One review in a divided list. The overall score sits in its own narrow column
 * so scores and text can each be scanned straight down the page.
 */
export function ReviewCard({
  review,
  report,
}: {
  review: Review
  /** Offers "Report" under the review; left out where reporting makes no sense (samples). */
  report?: { signedIn: boolean; signInHref: string }
}) {
  return (
    <article className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 border-t border-rule py-6">
      <p className="tnum text-title font-semibold">
        <span aria-hidden>{review.overall}</span>
        <span className="sr-only">Overall {review.overall} out of 5</span>
      </p>

      <div className="flex max-w-[65ch] flex-col gap-4">
        <p className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted">
          {/* lease_term is stored as "2024-25"; the en dash is display only. */}
          <span>Lived here {review.lease_term.replace('-', '–')}</span>
          <span aria-hidden>·</span>
          <span>Posted {postedMonth(review.created_at)}</span>
          {review.is_sample && <SampleBadge />}
        </p>

        <p className="text-body break-words">{review.body}</p>

        <SubRatingsInline ratings={review} />

        {report && !review.is_sample && (
          <ReportReview reviewId={review.id} signedIn={report.signedIn} signInHref={report.signInHref} />
        )}
      </div>
    </article>
  )
}
