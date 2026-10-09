'use client' // Error boundaries must be Client Components.

import Link from 'next/link'

/**
 * Shown when a page fails to render — in practice, when the database cannot be
 * reached. Next 16 passes `retry`, which re-fetches the segment; `reset` would
 * re-render without fetching again, which cannot fix a failed query.
 *
 * In production `error.message` is a generic string and `digest` matches the
 * server log line, so the digest is the useful thing to show.
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 md:px-6">
      <h1 className="text-heading font-semibold">This page couldn&rsquo;t load.</h1>
      <p className="mt-2 text-body text-ink-soft">
        Usually that means the reviews database didn&rsquo;t answer in time. Trying again often
        works.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className="h-12 bg-accent px-6 text-body font-semibold text-surface hover:bg-accent-dark"
        >
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex h-12 items-center border border-rule-strong bg-surface px-6 text-body font-semibold"
        >
          All properties
        </Link>
      </div>
      {error.digest && <p className="mt-6 text-meta text-muted">Reference: {error.digest}</p>}
    </div>
  )
}
