'use client'

import Link from 'next/link'
import { useActionState, useEffect, useRef } from 'react'
import { submitReview, type ReviewFormState } from '@/app/actions'
import { RATING_LABELS, SUB_RATING_KEYS, type RatingKey } from '@/lib/types'

const initialState: ReviewFormState = { error: null, success: false }

const HINTS: Record<RatingKey, string> = {
  overall: 'Would you sign again?',
  maintenance: 'How fast did things get fixed?',
  communication: 'Could you reach the office?',
  value: 'Worth what you paid?',
}

const inputClass = 'border border-rule-strong bg-surface px-4 text-body'

export function ReviewForm({ slug }: { slug: string }) {
  const [state, formAction, pending] = useActionState(submitReview, initialState)
  // Marks the form once React has committed it; the end-to-end tests wait for it.
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    formRef.current?.setAttribute('data-hydrated', '')
  }, [])

  if (state.success) {
    return (
      <div role="status" className="border-t border-rule py-6">
        <p className="text-title font-semibold">Thanks — your review is live.</p>
        <p className="mt-1 text-meta text-muted">It now appears at the top of the reviews above.</p>
      </div>
    )
  }

  // After a failed submission React resets the form to its default values, so
  // the defaults are what the student just typed (returned by submitReview).
  const values = state.values

  // Field names are unchanged (submitReview reads fields by name); only the
  // order on screen moved, so it reads top to bottom like a short survey.
  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-8">
      <input type="hidden" name="slug" value={slug} />

      <label className="flex flex-col gap-2">
        <span className="text-body font-semibold">When did you live here?</span>
        <input
          name="lease_term"
          required
          maxLength={40}
          placeholder="2024-25"
          defaultValue={values?.lease_term}
          className={`h-12 md:max-w-48 ${inputClass}`}
        />
      </label>

      <RatingInput
        name="overall"
        label={RATING_LABELS.overall}
        hint={HINTS.overall}
        initial={values?.ratings.overall}
      />

      <div className="flex flex-col gap-8">
        {SUB_RATING_KEYS.map((key) => (
          <RatingInput
            key={key}
            name={key}
            label={RATING_LABELS[key]}
            hint={HINTS[key]}
            initial={values?.ratings[key]}
          />
        ))}
      </div>

      <label className="flex flex-col gap-2">
        <span className="text-body font-semibold">Your review</span>
        <textarea
          name="body"
          required
          minLength={20}
          maxLength={2000}
          rows={6}
          placeholder="What should the next tenant know? Repairs, the office, noise, what you actually paid."
          defaultValue={values?.body}
          className={`py-3 ${inputClass}`}
        />
        <span className="text-meta text-muted">
          Posted anonymously. Please don&rsquo;t name individual employees; see the{' '}
          <Link href="/policies#guidelines" className="underline">guidelines</Link>.
        </span>
      </label>

      {state.error && (
        <p role="alert" className="border-l-2 border-ink pl-3 text-body">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="h-12 bg-accent px-6 text-body font-semibold text-surface transition-colors hover:bg-accent-dark disabled:opacity-50 md:self-start"
      >
        {pending ? 'Posting…' : 'Post review'}
      </button>
    </form>
  )
}

/**
 * Five radio buttons shown as a segmented 1–5 control. Only the chosen number
 * fills, so it reads as "a score of 4", not a row of stars. Still a real radio
 * group underneath, so arrow keys and screen readers work natively.
 *
 * The highlight comes from the radio's own checked state (`peer-checked`), not
 * React state. A form reset changes which radio is checked without telling
 * React, and separate state would then show a score that will not be sent.
 */
function RatingInput({
  name,
  label,
  hint,
  initial,
}: {
  name: string
  label: string
  hint: string
  initial?: number
}) {
  return (
    <fieldset>
      <legend className="text-body font-semibold">{label}</legend>
      <p className="text-meta text-muted">{hint}</p>
      <div className="mt-2 flex gap-1">
        {[1, 2, 3, 4, 5].map((score) => (
          <label key={score} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              value={score}
              required
              defaultChecked={initial === score}
              className="peer sr-only"
            />
            <span className="tnum flex size-11 items-center justify-center border border-rule-strong bg-surface text-body transition-colors hover:border-ink peer-checked:border-accent peer-checked:bg-accent peer-checked:font-semibold peer-checked:text-surface peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
              {score}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
