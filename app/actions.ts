'use server'

import { revalidatePath } from 'next/cache'
import { insertReview } from '@/lib/queries'
import { RATING_KEYS, type RatingKey } from '@/lib/types'

/** What the student typed, so the form can be refilled after an error. */
export type ReviewFormValues = {
  lease_term: string
  body: string
  ratings: Partial<Record<RatingKey, number>>
}

export type ReviewFormState = { error: string | null; success: boolean; values?: ReviewFormValues }

/** Matches the API's limit and the `reviews_lease_term_length` constraint. */
const LEASE_TERM_MAX = 40

/**
 * Server Action: runs only on the server, invoked by the review <form>.
 *
 * Validation lives here rather than only in the browser because a Server Action
 * is reachable by a direct POST — client-side `required` attributes are a
 * convenience, not a guard. Postgres CHECK constraints (supabase/schema.sql)
 * are the third and final layer.
 *
 * Every failure returns the submitted values. React resets a form after its
 * action runs, whatever the action returns, so without them one validation
 * message would wipe a review the student spent minutes writing.
 */
export async function submitReview(
  _prevState: ReviewFormState,
  formData: FormData
): Promise<ReviewFormState> {
  const propertyId = String(formData.get('property_id') ?? '')
  const slug = String(formData.get('slug') ?? '')
  const rawBody = String(formData.get('body') ?? '')
  const rawLeaseTerm = String(formData.get('lease_term') ?? '')
  const body = rawBody.trim()
  const leaseTerm = rawLeaseTerm.trim()

  const ratings: Partial<Record<RatingKey, number>> = {}
  for (const key of RATING_KEYS) {
    const score = Number(formData.get(key))
    if (Number.isInteger(score) && score >= 1 && score <= 5) ratings[key] = score
  }

  const fail = (error: string): ReviewFormState => ({
    error,
    success: false,
    values: { lease_term: rawLeaseTerm, body: rawBody, ratings },
  })

  if (!propertyId || !slug) return fail('Something went wrong. Please reload and try again.')
  if (RATING_KEYS.some((key) => ratings[key] === undefined)) return fail('Please rate all four categories.')
  if (!leaseTerm) return fail('Please say which lease year this was.')
  if (leaseTerm.length > LEASE_TERM_MAX) return fail('Please keep the lease year short, like 2024-25.')
  if (body.length < 20) return fail('Please write at least 20 characters so the review is useful.')
  if (body.length > 2000) return fail('Please keep your review under 2000 characters.')

  try {
    await insertReview({
      property_id: propertyId,
      ...(ratings as Record<RatingKey, number>),
      body,
      lease_term: leaseTerm,
    })
  } catch (error) {
    // Logged in full on the server; the student gets their text back and a
    // message that does not leak database details.
    console.error('submitReview failed', error)
    return fail('We couldn’t save your review just now. Please try again in a moment.')
  }

  // Drop the cached render of both pages so the new review and the recomputed
  // averages appear immediately.
  revalidatePath(`/properties/${slug}`)
  revalidatePath('/')

  return { error: null, success: true }
}
