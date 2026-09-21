import Link from 'next/link'
import { RatingBars, ScoreNumeral } from './Ratings'
import type { PropertyWithStats } from '@/lib/types'

function bedroomRange(bedrooms: number[]) {
  if (!bedrooms.length) return null
  const min = Math.min(...bedrooms)
  const max = Math.max(...bedrooms)
  return min === max ? `${min} BR` : `${min}–${max} BR`
}

export function PropertyCard({ property }: { property: PropertyWithStats }) {
  const beds = bedroomRange(property.bedrooms)

  return (
    <article className="relative border border-rule bg-paper-card transition-colors hover:border-ink">
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="font-display text-2xl leading-tight">
              <Link href={`/properties/${property.slug}`} className="hover:text-accent">
                {/* Stretched link makes the whole card clickable without nesting anchors. */}
                <span className="absolute inset-0" aria-hidden />
                {property.name}
              </Link>
            </h3>
            <p className="label mt-1 truncate">
              {property.company?.name ?? 'Independent'} · {property.neighborhood}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <ScoreNumeral score={property.averages.overall} />
            <p className="label mt-1">
              {property.reviewCount} {property.reviewCount === 1 ? 'review' : 'reviews'}
            </p>
          </div>
        </div>

        <p className="tnum mt-3 text-xs text-ink-soft">
          ${property.rent_min.toLocaleString()}–{property.rent_max.toLocaleString()}/mo
          {beds ? ` · ${beds}` : ''}
        </p>

        <div className="mt-4 border-t border-rule-soft pt-4">
          {property.reviewCount > 0 ? (
            <RatingBars averages={property.averages} />
          ) : (
            <p className="text-sm text-muted">No reviews yet — be the first.</p>
          )}
        </div>
      </div>
    </article>
  )
}
