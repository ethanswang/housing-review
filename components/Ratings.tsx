import { RATING_LABELS, SUB_RATING_KEYS, type Averages } from '@/lib/types'

/** The headline score: an editorial numeral, not a pill. */
export function ScoreNumeral({
  score,
  size = 'md',
}: {
  score: number | null
  size?: 'md' | 'lg'
}) {
  // The placeholder stands in for the numeral, so it is set at the same size —
  // otherwise an unreviewed card sits visibly lighter than its neighbours.
  const scale = size === 'lg' ? 'text-6xl' : 'text-[2.75rem]'
  if (score === null) {
    return <div className={`font-display leading-none text-muted ${scale}`}>—</div>
  }
  return (
    <div className="flex items-baseline gap-1">
      <span className={`font-display leading-none ${scale}`}>{score.toFixed(1)}</span>
      <span className="label">/5</span>
    </div>
  )
}

/** One category: label, proportional rule, value. Reads like a results table. */
function Bar({ label, score }: { label: string; score: number | null }) {
  return (
    <div className="flex items-center gap-3">
      <span className="label w-30 shrink-0">{label}</span>
      <span className="h-[3px] flex-1 bg-rule-soft">
        <span
          className="block h-full bg-accent"
          style={{ width: score === null ? '0%' : `${(score / 5) * 100}%` }}
        />
      </span>
      <span className="tnum w-7 shrink-0 text-right text-xs text-ink">
        {score === null ? '—' : score.toFixed(1)}
      </span>
    </div>
  )
}

/** The three sub-scores. `overall` is shown separately as the headline numeral. */
export function RatingBars({ averages }: { averages: Averages }) {
  return (
    <div className="flex flex-col gap-2">
      {SUB_RATING_KEYS.map((key) => (
        <Bar key={key} label={RATING_LABELS[key]} score={averages[key]} />
      ))}
    </div>
  )
}

export function SampleBadge() {
  return (
    <span className="label border border-accent px-1.5 py-0.5 text-[0.625rem]">
      Sample data
    </span>
  )
}
