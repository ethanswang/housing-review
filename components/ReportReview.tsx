'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { submitReport, type ReportState } from '@/app/actions'

const REASONS = [
  ['personal_info', 'Shares personal information, or names a staff member'],
  ['harassment', 'Harassment or hate'],
  ['not_a_tenant', 'Not written by someone who lived here'],
  ['spam', 'Spam or advertising'],
  ['other', 'Something else'],
] as const

const initialState: ReportState = { sent: false, error: null }

/**
 * A quiet "Report" under a review. Signed-in students choose a reason; others
 * are sent to sign in. A report reaches a moderator and hides nothing by itself.
 */
export function ReportReview({ reviewId, signedIn, signInHref }: { reviewId: string; signedIn: boolean; signInHref: string }) {
  const [state, formAction, pending] = useActionState(submitReport, initialState)

  if (state.sent) {
    return (
      <p role="status" className="text-meta text-muted">
        Reported. A moderator will look at it.
      </p>
    )
  }

  return (
    <details className="text-meta text-muted">
      <summary className="inline-flex min-h-11 cursor-pointer items-center underline-offset-2 hover:underline">
        Report<span className="sr-only"> this review</span>
      </summary>
      {signedIn ? (
        <form action={formAction} className="mt-2 flex flex-col gap-3 border border-rule bg-surface p-4 text-body text-ink">
          <input type="hidden" name="review_id" value={reviewId} />
          <fieldset className="flex flex-col gap-2">
            <legend className="font-semibold">What is wrong with this review?</legend>
            {REASONS.map(([value, label]) => (
              <label key={value} className="flex min-h-11 items-center gap-3">
                <input
                  type="radio"
                  name="reason"
                  value={value}
                  required
                  defaultChecked={state.values?.reason === value}
                  className="size-4"
                />
                {label}
              </label>
            ))}
          </fieldset>
          <label className="flex flex-col gap-2">
            <span className="text-meta text-muted">Anything a moderator should know (optional)</span>
            <textarea
              name="details"
              rows={2}
              maxLength={1000}
              defaultValue={state.values?.details}
              className="border border-rule-strong bg-surface px-3 py-2"
            />
          </label>
          {state.error && (
            <p role="alert" className="border-l-2 border-ink pl-3">
              {state.error}
            </p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="h-11 border border-rule-strong bg-surface px-4 font-semibold hover:border-ink disabled:opacity-50 md:self-start"
          >
            {pending ? 'Sending…' : 'Send report'}
          </button>
        </form>
      ) : (
        <p className="mt-1">
          <Link href={signInHref} className="underline">
            Sign in
          </Link>{' '}
          with your @illinois.edu email to report a review.
        </p>
      )}
    </details>
  )
}
