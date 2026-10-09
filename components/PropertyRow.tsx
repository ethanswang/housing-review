import Link from 'next/link'
import { Score } from './Ratings'
import { bedroomRange, rentRange, sizeLabel } from '@/lib/format'
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
  // Only what is known: imported buildings often have a size and nothing else,
  // and a row of "not listed" says less than leaving it out.
  // The address tells apart buildings that share a name (Champaign has two
  // "Latitude" towers); it is left out when the name already is the address.
  const address = property.address.toLowerCase().startsWith(property.name.toLowerCase()) ? null : property.address
  const who = [property.company?.name, property.neighborhood, address].filter(Boolean).join(' · ')
  const facts = [
    rentRange(property.rent_min, property.rent_max, property.rent_basis),
    bedroomRange(property.bedrooms),
    sizeLabel(property.unit_count, property.stories),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <li className="border-b border-rule">
      <Link href={`/properties/${property.slug}`} className="group flex gap-4 py-4">
        <div className="min-w-0 flex-1">
          <Heading className="text-title font-semibold group-hover:underline">{property.name}</Heading>
          {who && <p className="truncate text-meta text-muted">{who}</p>}
          {facts && <p className="tnum mt-1 text-meta text-ink-soft">{facts}</p>}
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
