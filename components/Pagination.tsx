import Link from 'next/link'
import { pageQuery } from '@/lib/filters'
import type { PropertyFilters } from '@/lib/types'

const linkClass =
  'inline-flex h-11 items-center border border-rule-strong bg-surface px-4 text-body font-semibold'

/** Previous and next links for the directory; each keeps the filters and scrolls to the top. */
export function Pagination({ filters, page, totalPages }: { filters: PropertyFilters; page: number; totalPages: number }) {
  if (totalPages <= 1) return null
  const href = (n: number) => {
    const query = pageQuery(filters, n)
    return query ? `/?${query}` : '/'
  }
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-4 border-t border-rule py-4">
      {page > 1 ? (
        <Link href={href(page - 1)} rel="prev" className={linkClass}>
          Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="tnum text-meta text-muted">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={href(page + 1)} rel="next" className={linkClass}>
          Next
        </Link>
      ) : (
        <span />
      )}
    </nav>
  )
}
