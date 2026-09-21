'use client'

import { useActionState, useState } from 'react'
import { submitReview, type ReviewFormState } from '@/app/actions'
import { RATING_KEYS, RATING_LABELS, type RatingKey } from '@/lib/types'

const initialState: ReviewFormState = { error: null, success: false }

const HINTS: Record<RatingKey, string> = {
  overall: 'Would you sign again?',
  maintenance: 'How fast did things get fixed?',
  communication: 'Could you reach the office?',
  value: 'Worth what you paid?',
}

export function ReviewForm({ propertyId, slug }: { propertyId: string; slug: string }) {
  const [state, formAction, pending] = useActionState(submitReview, initialState)

  if (state.success) {
    return (
      <div className="border border-accent bg-accent-dim px-6 py-8 text-center">
        <p className="text-2xl">Thanks — your review is live.</p>
      </div>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="property_id" value={propertyId} />
      <input type="hidden" name="slug" value={slug} />

      <div className="grid gap-5 sm:grid-cols-2">
        {RATING_KEYS.map((key) => (
          <StarInput key={key} name={key} label={RATING_LABELS[key]} hint={HINTS[key]} />
        ))}
      </div>

      <label className="flex flex-col gap-2">
        <span className="label">Lease year</span>
        <input
          name="lease_term"
          required
          placeholder="2024-25"
          className="border border-rule bg-paper-card px-3 py-2 text-sm"
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className="label">Your review</span>
        <textarea
          name="body"
          required
          minLength={20}
          maxLength={2000}
          rows={5}
          placeholder="What should the next tenant know? Repairs, the office, noise, what you actually paid."
          className="border border-rule bg-paper-card px-3 py-2 text-sm leading-relaxed"
        />
        <span className="text-xs text-muted">
          Posted anonymously. Please don&rsquo;t name individual employees.
        </span>
      </label>

      {state.error && (
        <p role="alert" className="border-l-2 border-accent bg-accent-dim px-3 py-2 text-sm">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="self-start bg-ink px-6 py-3 text-xs tracking-[0.12em] text-paper uppercase transition-colors hover:bg-accent disabled:opacity-50"
      >
        {pending ? 'Posting…' : 'Post review'}
      </button>
    </form>
  )
}

/** Five radio buttons styled as a rating strip; still a real radio group underneath. */
function StarInput({ name, label, hint }: { name: string; label: string; hint: string }) {
  const [value, setValue] = useState(0)
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
      <div className="mt-2 flex gap-1.5">
        {[1, 2, 3, 4, 5].map((score) => (
          <label key={score} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              value={score}
              required
              onChange={() => setValue(score)}
              className="sr-only"
            />
            <span
              className={`tnum flex size-9 items-center justify-center border text-xs transition-colors ${
                value >= score
                  ? 'border-accent bg-accent text-paper-card'
                  : 'border-rule bg-paper-card hover:border-ink'
              }`}
            >
              {score}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
