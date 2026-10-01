import Link from 'next/link'
import { Score } from './Ratings'
import { bedroomRange } from '@/lib/format'
import type { PropertyWithStats } from '@/lib/types'


/**
 * One result in a divided list — the whole row is the link. The score column is
 * a fixed width so scores line up down the page and can be scanned as a column.
 */
export function PropertyRow({
  property,
  headingLevel = 2,
}: {
  property: PropertyWithStats
  /** 3 when the list sits under its own h2, as on the company page. */
  headingLevel?: 2 | 3
}) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2'
  const beds = bedroomRange(property.bedrooms)

  return (
    <li className="border-b border-rule">
      <Link href={`/properties/${property.slug}`} className="group flex gap-4 py-4">
        <div className="min-w-0 flex-1">
          <Heading className="text-title font-semibold group-hover:underline">{property.name}</Heading>
          <p className="truncate text-meta text-muted">
            {property.company?.name ?? 'Independent'} · {property.neighborhood}
          </p>
          <p className="tnum mt-1 text-meta text-ink-soft">
            ${property.rent_min.toLocaleString()}–{property.rent_max.toLocaleString()}/mo
            {beds ? ` · ${beds}` : ''}
          </p>
        </div>
        <div className="w-20 shrink-0 text-right">
          <Score score={property.averages.overall} />
          <p className="text-meta text-muted">
            {property.reviewCount === 0
              ? 'No reviews'
              : `${property.reviewCount} ${property.reviewCount === 1 ? 'review' : 'reviews'}`}
          </p>
        </div>
      </Link>
    </li>
  )
}
