'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { buildQuery, hasActiveFilters } from '@/lib/filters'
import type { Company, PropertyFilters } from '@/lib/types'

type Options = {
  companies: Company[]
  neighborhoods: string[]
  bedrooms: number[]
  maxRent: number
}

/**
 * Writes filter state into the URL. It never holds the filtered list — the
 * server page re-runs the query for the new URL and streams back new results.
 */
export function FilterRail({ filters, options }: { filters: PropertyFilters; options: Options }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  // Local mirror so the rent slider tracks the thumb while the server catches up.
  const [rent, setRent] = useState(filters.maxRent ?? options.maxRent)

  // On a phone the rail would otherwise push every property below the fold, so
  // it collapses into a disclosure. On desktop it is always open and the
  // summary is hidden. Starts closed on both so the server and client agree on
  // the first render, then opens on desktop once we can measure the viewport.
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)')
    const sync = () => setOpen(desktop.matches)
    sync()
    desktop.addEventListener('change', sync)
    return () => desktop.removeEventListener('change', sync)
  }, [])

  function apply(next: PropertyFilters) {
    const query = buildQuery(next)
    startTransition(() => router.push(query ? `/?${query}` : '/', { scroll: false }))
  }

  function toggle<T>(current: T[] | undefined, item: T): T[] {
    const list = current ?? []
    return list.includes(item) ? list.filter((x) => x !== item) : [...list, item]
  }

  const rentCeiling = Math.ceil(options.maxRent / 50) * 50

  return (
    <aside
      className={`transition-opacity ${isPending ? 'opacity-60' : 'opacity-100'}`}
      aria-busy={isPending}
    >
      <details
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
        className="border-b border-ink lg:border-b-0"
      >
        <summary className="flex cursor-pointer list-none items-baseline justify-between py-2 lg:hidden [&::-webkit-details-marker]:hidden">
          <h2 className="text-xl">Refine</h2>
          <span className="label">{open ? 'Hide' : 'Filter & sort'}</span>
        </summary>

        <div className="flex flex-col gap-7 pb-6 lg:pb-0">
          <div className="hidden items-baseline justify-between border-b border-ink pb-2 lg:flex">
            <h2 className="text-xl">Refine</h2>
            {hasActiveFilters(filters) && (
              <button
                type="button"
                onClick={() => apply({ sort: filters.sort })}
                className="label hover:text-accent"
              >
                Clear all
              </button>
            )}
          </div>

          <Group title="Sort by">
            <select
              value={filters.sort ?? 'rating'}
              onChange={(e) => apply({ ...filters, sort: e.target.value as PropertyFilters['sort'] })}
              className="w-full border border-rule bg-paper-card px-3 py-2 text-sm"
            >
              <option value="rating">Highest rated</option>
              <option value="price">Lowest price</option>
              <option value="reviews">Most reviewed</option>
            </select>
          </Group>

          <Group title="Management company">
            {options.companies.map((company) => (
              <Check
                key={company.slug}
                label={company.name}
                checked={filters.companies?.includes(company.slug) ?? false}
                onChange={() => apply({ ...filters, companies: toggle(filters.companies, company.slug) })}
              />
            ))}
          </Group>

          <Group title="Area">
            {options.neighborhoods.map((hood) => (
              <Check
                key={hood}
                label={hood}
                checked={filters.neighborhoods?.includes(hood) ?? false}
                onChange={() => apply({ ...filters, neighborhoods: toggle(filters.neighborhoods, hood) })}
              />
            ))}
          </Group>

          <Group title="Max rent">
            <input
              type="range"
              min={400}
              max={rentCeiling}
              step={25}
              value={rent}
              onChange={(e) => setRent(Number(e.target.value))}
              onMouseUp={() => apply({ ...filters, maxRent: rent >= rentCeiling ? undefined : rent })}
              onTouchEnd={() => apply({ ...filters, maxRent: rent >= rentCeiling ? undefined : rent })}
              onKeyUp={() => apply({ ...filters, maxRent: rent >= rentCeiling ? undefined : rent })}
              className="w-full accent-accent"
              aria-label="Maximum rent per month"
            />
            <p className="tnum text-xs text-ink-soft">
              {rent >= rentCeiling ? 'Any price' : `Up to $${rent.toLocaleString()}/mo`}
            </p>
          </Group>

          <Group title="Bedrooms">
            <div className="flex flex-wrap gap-2">
              {options.bedrooms.map((count) => {
                const active = filters.bedrooms?.includes(count) ?? false
                return (
                  <button
                    key={count}
                    type="button"
                    onClick={() => apply({ ...filters, bedrooms: toggle(filters.bedrooms, count) })}
                    aria-pressed={active}
                    className={`tnum min-w-10 border px-3 py-1.5 text-xs transition-colors ${
                      active
                        ? 'border-accent bg-accent text-paper-card'
                        : 'border-rule bg-paper-card hover:border-ink'
                    }`}
                  >
                    {count}
                  </button>
                )
              })}
            </div>
          </Group>

          {hasActiveFilters(filters) && (
            <button
              type="button"
              onClick={() => apply({ sort: filters.sort })}
              className="label self-start border border-rule px-3 py-2 hover:border-ink hover:text-accent lg:hidden"
            >
              Clear all filters
            </button>
          )}
        </div>
      </details>
    </aside>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="label">{title}</h3>
      {children}
    </div>
  )
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm hover:text-accent">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="size-3.5 shrink-0 accent-accent"
      />
      {label}
    </label>
  )
}
