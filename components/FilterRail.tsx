'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useOptimistic, useRef, useState, useTransition } from 'react'
import { RENT_SLIDER_PAUSE_MS, buildQuery, hasActiveFilters } from '@/lib/filters'
import { bedroomLabel } from '@/lib/format'
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
  /**
   * What the controls show and what the next change builds on. The `filters`
   * prop only updates once the server's new render arrives, so building each
   * change from it made a second click inside one round trip overwrite the
   * first: ticking two companies quickly kept only the second. The optimistic
   * value holds every pending change until the navigation completes.
   */
  const [current, setCurrent] = useOptimistic(filters)
  /**
   * Where the rent slider sits while it is being moved, before that change
   * has been applied; null the rest of the time, when the slider shows the
   * optimistic filters like every other control. Keeping no separate copy of
   * the rent otherwise is what stops a slow, older navigation landing from
   * snapping the thumb back under the user's finger.
   */
  const [draftRent, setDraftRent] = useState<number | null>(null)
  // The company list is long; it shows a few until asked, but never hides a
  // company that is checked.
  const [allCompanies, setAllCompanies] = useState(false)
  const rentTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // The same value as draftRent, readable from handlers without waiting for a render.
  const pendingRent = useRef<number | undefined>(undefined)

  /** Forgets a slider change that has not been applied yet. */
  function cancelRentDraft() {
    clearTimeout(rentTimer.current)
    rentTimer.current = undefined
    pendingRent.current = undefined
    setDraftRent(null)
  }

  const sheet = useRef<HTMLDialogElement>(null)
  // Marks the rail once React has committed it, which is when its handlers
  // work. The end-to-end tests wait for this rather than guessing.
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    root.current?.setAttribute('data-hydrated', '')
  }, [])
  // The sheet is hidden at desktop widths; a modal left open across the
  // breakpoint would leave the page inert behind an invisible dialog.
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)')
    const close = () => desktop.matches && sheet.current?.close()
    desktop.addEventListener('change', close)
    return () => desktop.removeEventListener('change', close)
  }, [])

  /**
   * A slider change still waiting out its pause is settled by the next change
   * instead of landing on top of it later. Usually it is carried into that
   * change, since the user meant both. `discardRent` drops it instead, for the
   * two changes that mean "no rent filter": "Clear all" and removing the rent
   * chip, which would otherwise be undone a moment later.
   */
  function apply(next: PropertyFilters, { fromSlider = false, discardRent = false } = {}) {
    if (!fromSlider) {
      if (pendingRent.current !== undefined && !discardRent) {
        next = { ...next, maxRent: rentFilter(pendingRent.current) }
      }
      cancelRentDraft()
    }
    const query = buildQuery(next)
    startTransition(() => {
      setCurrent(next)
      router.push(query ? `/?${query}` : '/', { scroll: false })
    })
  }

  // Back and forward change the filters without going through apply, and a
  // pending slider change landing afterwards would undo the navigation.
  useEffect(() => {
    window.addEventListener('popstate', cancelRentDraft)
    return () => window.removeEventListener('popstate', cancelRentDraft)
  }, [])

  function toggle<T>(current: T[] | undefined, item: T): T[] {
    const list = current ?? []
    return list.includes(item) ? list.filter((x) => x !== item) : [...list, item]
  }

  const rentCeiling = Math.ceil(options.maxRent / 50) * 50

  /**
   * The slider applies a short pause after it stops moving. It used to apply
   * on mouseup, touchend and keyup, but assistive technology (VoiceOver's
   * swipe, for one) changes the value with none of those, so the label moved
   * and the filter never did. Waiting also avoids a navigation per step while
   * dragging or holding an arrow key.
   */
  useEffect(() => () => clearTimeout(rentTimer.current), [])
  // Read when the timer fires, not when the slider moved: a checkbox ticked
  // during the pause must not be undone by the rent change landing after it.
  const latest = useRef(current)
  useEffect(() => {
    latest.current = current
  }, [current])
  /** The slider at its top means no limit. */
  const rentFilter = (value: number) => (value >= rentCeiling ? undefined : value)
  function changeRent(value: number) {
    setDraftRent(value)
    pendingRent.current = value
    clearTimeout(rentTimer.current)
    rentTimer.current = setTimeout(() => {
      rentTimer.current = undefined
      pendingRent.current = undefined
      // Cleared in the same update that sets the optimistic filters, so the
      // slider passes from the draft to the applied value without a frame of
      // the old one in between.
      setDraftRent(null)
      apply({ ...latest.current, maxRent: rentFilter(value) }, { fromSlider: true })
    }, RENT_SLIDER_PAUSE_MS)
  }
  const rentValue = draftRent ?? current.maxRent ?? rentCeiling
  // A slider change waiting to apply is as much "not up to date" as a
  // navigation in flight; the sheet's count must not claim otherwise.
  const updating = isPending || draftRent !== null
  const clearAll = () => apply({ sort: current.sort }, { discardRent: true })

  // One chip per active filter, each removing only itself.
  const chips: { key: string; label: string; remove: PropertyFilters }[] = [
    ...(current.search
      ? [{ key: 'q', label: `“${current.search}”`, remove: { ...current, search: undefined } }]
      : []),
    ...(current.companies ?? []).map((slug) => ({
      key: `c-${slug}`,
      label: options.companies.find((c) => c.slug === slug)?.name ?? slug,
      remove: { ...current, companies: toggle(current.companies, slug) },
    })),
    ...(current.neighborhoods ?? []).map((hood) => ({
      key: `h-${hood}`,
      label: hood,
      remove: { ...current, neighborhoods: toggle(current.neighborhoods, hood) },
    })),
    ...(current.maxRent
      ? [{ key: 'rent', label: `Up to $${current.maxRent.toLocaleString('en-US')}`, remove: { ...current, maxRent: undefined } }]
      : []),
    ...(current.bedrooms ?? []).map((count) => ({
      key: `b-${count}`,
      label: bedroomLabel(count),
      remove: { ...current, bedrooms: toggle(current.bedrooms, count) },
    })),
  ]

  const sortSelect = (
    <select
      value={current.sort ?? 'rating'}
      onChange={(e) => apply({ ...current, sort: e.target.value as PropertyFilters['sort'] })}
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
        {options.companies
          .filter((company, i) => allCompanies || i < COMPANIES_SHOWN || current.companies?.includes(company.slug))
          .map((company) => (
            <Check
              key={company.slug}
              label={company.name}
              checked={current.companies?.includes(company.slug) ?? false}
              onChange={() => apply({ ...current, companies: toggle(current.companies, company.slug) })}
            />
          ))}
        {options.companies.length > COMPANIES_SHOWN && (
          <button
            type="button"
            aria-expanded={allCompanies}
            onClick={() => setAllCompanies(!allCompanies)}
            className="min-h-11 self-start text-meta font-semibold underline"
          >
            {allCompanies ? 'Show fewer' : `Show all ${options.companies.length} companies`}
          </button>
        )}
      </Group>

      <Group title="Area">
        {options.neighborhoods.map((hood) => (
          <Check
            key={hood}
            label={hood}
            checked={current.neighborhoods?.includes(hood) ?? false}
            onChange={() => apply({ ...current, neighborhoods: toggle(current.neighborhoods, hood) })}
          />
        ))}
      </Group>

      {/* The slider starts at $400; with no rents above that it would have a
          minimum above its maximum, so it is left out. */}
      {rentCeiling > 400 && (
        <Group title="Max rent">
          <p className="tnum text-body">
            {rentValue >= rentCeiling ? 'Any price' : `Up to $${rentValue.toLocaleString('en-US')}/mo`}
          </p>
          <input
            type="range"
            min={400}
            max={rentCeiling}
            step={25}
            value={rentValue}
            onChange={(e) => changeRent(Number(e.target.value))}
            className="h-11 w-full accent-accent"
            aria-label="Maximum rent per month"
          />
        </Group>
      )}

      <Group title="Bedrooms">
        <div className="flex flex-wrap gap-2">
          {options.bedrooms.map((count) => {
            const active = current.bedrooms?.includes(count) ?? false
            return (
              <button
                key={count}
                type="button"
                onClick={() => apply({ ...current, bedrooms: toggle(current.bedrooms, count) })}
                aria-pressed={active}
                className={`tnum h-11 min-w-11 px-3 rounded-lg border text-body transition-colors ${
                  active
                    ? 'border-accent bg-accent text-surface'
                    : 'border-rule-strong bg-surface hover:border-ink'
                }`}
              >
                {count === 0 ? 'Studio' : count}
              </button>
            )
          })}
        </div>
      </Group>
    </>
  )

  return (
    <div
      ref={root}
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
                  onClick={() => apply(chip.remove, { discardRent: chip.key === 'rent' })}
                  aria-label={`Remove filter: ${chip.label}`}
                  className="flex h-11 items-center"
                >
                  <span className="flex h-8 items-center gap-1.5 rounded-lg border border-rule-strong bg-surface px-3 text-meta whitespace-nowrap">
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
              {hasActiveFilters(current) && (
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
              {updating
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
          {hasActiveFilters(current) && (
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

/** Companies listed before "Show all". */
const COMPANIES_SHOWN = 6

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
