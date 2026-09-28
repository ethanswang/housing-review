import { RATING_LABELS, SUB_RATING_KEYS, type Averages } from '@/lib/types'

/*
 * One rating system everywhere (DESIGN.md §4): every rating is a number, a
 * sub-rating is a number plus a bar, the overall score is a number alone.
 * Bars are ink, not accent — a coloured bar reads as "good" even at 1.8.
 */

/** The overall score. `null` renders a dash at the same size so rows stay aligned. */
export function Score({ score, size = 'title' }: { score: number | null; size?: 'title' | 'large' }) {
  const scale = size === 'large' ? 'text-heading md:text-display' : 'text-title'
  if (score === null) return <span className={`tnum font-semibold text-muted ${scale}`}>—</span>
  return <span className={`tnum font-semibold ${scale}`}>{score.toFixed(1)}</span>
}

function Bar({ score, className }: { score: number | null; className: string }) {
  return (
    <span className={`block h-1 rounded-full bg-rule ${className}`} aria-hidden>
      <span
        className="block h-full rounded-full bg-ink"
        style={{ width: score === null ? '0%' : `${(score / 5) * 100}%` }}
      />
    </span>
  )
}

/** Overall score, review count and the three sub-rating bars. Detail and company pages. */
export function RatingSummary({ averages, reviewCount }: { averages: Averages; reviewCount: number }) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <Score score={averages.overall} size="large" />
        <span className="text-meta text-muted">
          out of 5 · {reviewCount} {reviewCount === 1 ? 'review' : 'reviews'}
        </span>
      </div>
      <dl className="mt-4 flex flex-col gap-2">
        {SUB_RATING_KEYS.map((key) => {
          const value = averages[key]
          return (
            <div key={key} className="grid grid-cols-[7.5rem_1fr_2rem] items-center gap-3">
              <dt className="text-meta text-ink-soft">{RATING_LABELS[key]}</dt>
              <Bar score={value} className="w-full" />
              <dd className="tnum text-right text-meta font-semibold">
                {value === null ? '—' : value.toFixed(1)}
              </dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}

/** A single review's sub-ratings as three columns: label over value and mini bar. */
export function SubRatingsInline({ ratings }: { ratings: Record<(typeof SUB_RATING_KEYS)[number], number> }) {
  return (
    <dl className="grid max-w-md grid-cols-3 gap-x-4">
      {SUB_RATING_KEYS.map((key) => (
        <div key={key} className="flex flex-col">
          <dt className="text-meta text-ink-soft">{RATING_LABELS[key]}</dt>
          <dd className="flex items-center gap-2">
            <span className="tnum text-meta font-semibold">{ratings[key]}</span>
            <Bar score={ratings[key]} className="w-10" />
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function SampleBadge() {
  return (
    <span className="rounded border border-rule-strong px-1.5 text-meta text-muted">Sample data</span>
  )
}
