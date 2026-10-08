'use server'

import { revalidatePath } from 'next/cache'
import { accessToken } from '@/lib/auth'
import { postReview, REPORT_REASONS, reportReview, type ReportReason } from '@/lib/queries'
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
 * convenience, not a guard. The API checks everything again and decides who
 * the author is from the student's token.
 *
 * Every failure returns the submitted values. React resets a form after its
 * action runs, whatever the action returns, so without them one validation
 * message would wipe a review the student spent minutes writing.
 */
export async function submitReview(
  _prevState: ReviewFormState,
  formData: FormData
): Promise<ReviewFormState> {
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

  // The API's slug format. Also keeps a forged ".." from steering the post to another API path.
  if (!/^[a-z0-9-]+$/.test(slug)) return fail('Something went wrong. Please reload and try again.')
  if (RATING_KEYS.some((key) => ratings[key] === undefined)) return fail('Please rate all four categories.')
  if (!leaseTerm) return fail('Please say which lease year this was.')
  if (leaseTerm.length > LEASE_TERM_MAX) return fail('Please keep the lease year short, like 2024-25.')
  if (body.length < 20) return fail('Please write at least 20 characters so the review is useful.')
  if (body.length > 2000) return fail('Please keep your review under 2000 characters.')

  const token = await accessToken()
  if (!token) return fail('Your sign-in has expired. Sign in again to post; copy your review first.')

  try {
    const result = await postReview(slug, { ...(ratings as Record<RatingKey, number>), body, lease_term: leaseTerm }, token)
    if (!result.ok) {
      console.error('submitReview: the API refused', result.status, result.code)
      return fail(refusal(result.status, result.code))
    }
  } catch (error) {
    // Logged in full on the server; the student gets their text back and a
    // message that does not leak internals.
    console.error('submitReview failed', error)
    return fail('We couldn’t save your review just now. Please try again in a moment.')
  }

  // Drop the cached render of both pages so the new review and the recomputed
  // averages appear immediately.
  revalidatePath(`/properties/${slug}`)
  revalidatePath('/')

  return { error: null, success: true }
}

/** What to tell the student when the API turns a review down. */
function refusal(status: number, code?: string): string {
  if (code === 'already_reviewed') return 'You have already reviewed this building.'
  if (status === 401) return 'Your sign-in has expired. Sign in again to post; copy your review first.'
  if (status === 403) return 'Sign in with the code emailed to your @illinois.edu address to post.'
  if (status === 404) return 'This building is no longer listed.'
  if (status === 429) return 'Too many reviews in a short time. Please try again later.'
  return 'We couldn’t save your review just now. Please try again in a moment.'
}

export type ReportState = { sent: boolean; error: string | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Reports a review for a moderator to look at. Nothing is hidden by a report. */
export async function submitReport(_prev: ReportState, formData: FormData): Promise<ReportState> {
  const reviewId = String(formData.get('review_id') ?? '')
  const reason = String(formData.get('reason') ?? '') as ReportReason
  const details = String(formData.get('details') ?? '').trim()

  // The id goes into the API's path, so it must be exactly an id.
  if (!UUID.test(reviewId)) return { sent: false, error: 'Something went wrong. Please reload and try again.' }
  if (!REPORT_REASONS.includes(reason)) return { sent: false, error: 'Please choose a reason.' }
  if (details.length > 1000) return { sent: false, error: 'Please keep the details under 1000 characters.' }

  const token = await accessToken()
  if (!token) return { sent: false, error: 'Your sign-in has expired. Sign in again to report.' }

  try {
    const result = await reportReview(reviewId, { reason, details: details || null }, token)
    if (result.ok) return { sent: true, error: null }
    console.error('submitReport: the API refused', result.status, result.code)
    if (result.code === 'already_reported') return { sent: true, error: null }
    if (result.status === 404) return { sent: false, error: 'This review is no longer shown.' }
    if (result.status === 429) return { sent: false, error: 'Too many reports in a short time. Please try again later.' }
    if (result.status === 401 || result.status === 403) {
      return { sent: false, error: 'Sign in with the code emailed to your @illinois.edu address to report.' }
    }
  } catch (error) {
    console.error('submitReport failed', error)
  }
  return { sent: false, error: 'We couldn’t send the report just now. Please try again in a moment.' }
}

