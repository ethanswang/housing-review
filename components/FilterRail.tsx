'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
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
 *
 * The same filter groups render in two containers: a left rail on desktop, and
 * a bottom sheet (native <dialog>) behind a "Filters" button on a phone. Every
 * change applies immediately in both, so the result count in the sheet's
 * footer updates while it is open.
 */
export function FilterRail({
  filters,
  options,
  resultCount,
}: {
  filters: PropertyFilters
  options: Options
  resultCount: number
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  // Local mirror so the rent slider tracks the thumb while the server catches up.
  const [rent, setRent] = useState(filters.maxRent ?? options.maxRent)
  // When the URL's rent changes from elsewhere (a chip, "Clear all"), snap the
  // slider back to it. Adjusting state during render is React's documented
  // pattern for this; a `key` would remount the rail and close an open sheet.
  const [syncedMaxRent, setSyncedMaxRent] = useState(filters.maxRent)
  if (filters.maxRent !== syncedMaxRent) {
    setSyncedMaxRent(filters.maxRent)
    setRent(filters.maxRent ?? options.maxRent)
  }

  const sheet = useRef<HTMLDialogElement>(null)
  // The sheet is hidden at desktop widths; a modal left open across the
  // breakpoint would leave the page inert behind an invisible dialog.
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)')
    const close = () => desktop.matches && sheet.current?.close()
    desktop.addEventListener('change', close)
    return () => desktop.removeEventListener('change', close)
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
  const applyRent = () => apply({ ...filters, maxRent: rent >= rentCeiling ? undefined : rent })
  const clearAll = () => apply({ sort: filters.sort })

  // One chip per active filter, each removing only itself.
  const chips: { key: string; label: string; remove: PropertyFilters }[] = [
    ...(filters.search
      ? [{ key: 'q', label: `“${filters.search}”`, remove: { ...filters, search: undefined } }]
      : []),
    ...(filters.companies ?? []).map((slug) => ({
      key: `c-${slug}`,
      label: options.companies.find((c) => c.slug === slug)?.name ?? slug,
      remove: { ...filters, companies: toggle(filters.companies, slug) },
    })),
    ...(filters.neighborhoods ?? []).map((hood) => ({
      key: `h-${hood}`,
      label: hood,
      remove: { ...filters, neighborhoods: toggle(filters.neighborhoods, hood) },
    })),
    ...(filters.maxRent
      ? [{ key: 'rent', label: `Up to $${filters.maxRent.toLocaleString()}`, remove: { ...filters, maxRent: undefined } }]
      : []),
    ...(filters.bedrooms ?? []).map((count) => ({
      key: `b-${count}`,
      label: `${count} BR`,
      remove: { ...filters, bedrooms: toggle(filters.bedrooms, count) },
    })),
  ]

  const sortSelect = (
    <select
      value={filters.sort ?? 'rating'}
      onChange={(e) => apply({ ...filters, sort: e.target.value as PropertyFilters['sort'] })}
      aria-label="Sort by"
      className="h-11 rounded-lg border border-rule-strong bg-surface px-3 text-body"
    >
      <option value="rating">Highest rated</option>
      <option value="price">Lowest price</option>
      <option value="reviews">Most reviewed</option>
    </select>
  )

  const groups = (
    <>
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
        <p className="tnum text-body">
          {rent >= rentCeiling ? 'Any price' : `Up to $${rent.toLocaleString()}/mo`}
        </p>
        <input
          type="range"
          min={400}
          max={rentCeiling}
          step={25}
          value={rent}
          onChange={(e) => setRent(Number(e.target.value))}
          onMouseUp={applyRent}
          onTouchEnd={applyRent}
          onKeyUp={applyRent}
          className="h-11 w-full accent-accent"
          aria-label="Maximum rent per month"
        />
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
                className={`tnum size-11 rounded-lg border text-body transition-colors ${
                  active
                    ? 'border-accent bg-accent text-surface'
                    : 'border-rule-strong bg-surface hover:border-ink'
                }`}
              >
                {count}
              </button>
            )
          })}
        </div>
      </Group>
    </>
  )

  return (
    <div
      className={`sticky top-0 z-10 -mx-4 bg-bg px-4 transition-opacity md:-mx-6 md:px-6 lg:static lg:mx-0 lg:bg-transparent lg:px-0 ${
        isPending ? 'opacity-60' : 'opacity-100'
      }`}
      aria-busy={isPending}
    >
      {/* Phone: control bar + chips. The groups live in the sheet below. */}
      <div className="border-b border-rule py-2 lg:hidden">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => sheet.current?.showModal()}
            className="h-11 flex-1 rounded-lg border border-rule-strong bg-surface px-4 text-body font-semibold"
          >
            Filters{chips.length > 0 && ` · ${chips.length}`}
          </button>
          {sortSelect}
        </div>

        {chips.length > 0 && (
          <ul className="-mx-4 mt-1 flex gap-2 overflow-x-auto px-4 md:-mx-6 md:px-6" aria-label="Active filters">
            {chips.map((chip) => (
              <li key={chip.key} className="shrink-0">
                <button
                  type="button"
                  onClick={() => apply(chip.remove)}
                  aria-label={`Remove filter: ${chip.label}`}
                  className="flex h-11 items-center"
                >
                  <span className="flex h-8 items-center gap-1.5 rounded-full border border-rule-strong bg-surface px-3 text-meta whitespace-nowrap">
                    {chip.label}
                    <span aria-hidden className="text-muted">✕</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <dialog
        ref={sheet}
        aria-label="Filters"
        // A click on the dialog element itself (not its content) is a click on the backdrop.
        onClick={(e) => e.target === e.currentTarget && sheet.current?.close()}
        className="mt-auto mb-0 max-h-[85dvh] w-full max-w-none rounded-t-lg bg-surface text-ink shadow-[0_-4px_24px_rgb(0_0_0/0.12)] backdrop:bg-ink/40 lg:hidden"
      >
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-center justify-between border-b border-rule px-4 py-2">
            <h2 className="text-title font-semibold">Filters</h2>
            <div className="flex gap-2">
              {hasActiveFilters(filters) && (
                <button type="button" onClick={clearAll} className="h-11 px-2 text-body text-accent">
                  Clear all
                </button>
              )}
              <button
                type="button"
                onClick={() => sheet.current?.close()}
                aria-label="Close filters"
                className="size-11 text-title"
              >
                ✕
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-6 overflow-y-auto px-4 py-4">{groups}</div>
          <div className="border-t border-rule p-4">
            <button
              type="button"
              onClick={() => sheet.current?.close()}
              className="h-12 w-full rounded-lg bg-accent text-body font-semibold text-surface hover:bg-accent-dark"
            >
              {isPending
                ? 'Updating…'
                : `Show ${resultCount} ${resultCount === 1 ? 'property' : 'properties'}`}
            </button>
          </div>
        </div>
      </dialog>

      {/* Desktop: the same groups as an always-open rail. */}
      <aside className="hidden flex-col gap-6 lg:flex" aria-label="Filters">
        <div className="flex items-baseline justify-between border-b border-rule pb-2">
          <h2 className="text-title font-semibold">Filters</h2>
          {hasActiveFilters(filters) && (
            <button type="button" onClick={clearAll} className="h-11 text-meta text-accent hover:underline">
              Clear all
            </button>
          )}
        </div>
        <Group title="Sort by">{sortSelect}</Group>
        {groups}
      </aside>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-meta font-semibold text-ink-soft">{title}</legend>
      {children}
    </fieldset>
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
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-body">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="size-5 shrink-0 accent-accent"
      />
      {label}
    </label>
  )
}
