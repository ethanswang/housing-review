import { RATING_KEYS, RATING_LABELS, type Review } from '@/lib/types'
import { SampleBadge } from './Ratings'

export function ReviewCard({ review }: { review: Review }) {
  return (
    <article className="border-t border-rule py-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="tnum font-display text-2xl leading-none">{review.overall.toFixed(1)}</span>
        <span className="label">Lease {review.lease_term}</span>
        {review.is_sample && <SampleBadge />}
      </div>

      <p className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed">{review.body}</p>

      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1">
        {RATING_KEYS.filter((key) => key !== 'overall').map((key) => (
          <div key={key} className="flex items-baseline gap-1.5">
            <dt className="label">{RATING_LABELS[key]}</dt>
            <dd className="tnum font-mono text-xs">{review[key]}/5</dd>
          </div>
        ))}
      </dl>
    </article>
  )
}
