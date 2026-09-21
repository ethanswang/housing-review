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
    <form onSubmit={submit} className="flex border-b-2 border-ink" role="search">
      <input
        type="search"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search a building or street — try “Green”"
        aria-label="Search properties by name or address"
        className="min-w-0 flex-1 bg-transparent py-3 text-2xl placeholder:text-muted focus:outline-none sm:text-3xl"
      />
      <button type="submit" className="label shrink-0 px-2 hover:text-accent">
        Search
      </button>
    </form>
  )
}
