'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { buildQuery } from '@/lib/filters'
import type { PropertyFilters } from '@/lib/types'

/**
 * Primary entry point. Most people arrive knowing the building they want to
 * look up, so search leads and the filters support it.
 */
export function SearchBox({ filters }: { filters: PropertyFilters }) {
  const router = useRouter()
  const [term, setTerm] = useState(filters.search ?? '')

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const query = buildQuery({ ...filters, search: term.trim() || undefined })
    router.push(query ? `/?${query}` : '/', { scroll: false })
  }

  return (
    <form onSubmit={submit} className="flex gap-2" role="search">
      <input
        type="search"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Building or street"
        aria-label="Search properties by name or address"
        className="h-12 min-w-0 flex-1 rounded-lg border border-rule-strong bg-surface px-4 text-body placeholder:text-muted"
      />
      <button
        type="submit"
        className="h-12 shrink-0 rounded-lg bg-accent px-5 text-body font-semibold text-surface hover:bg-accent-dark"
      >
        Search
      </button>
    </form>
  )
}
