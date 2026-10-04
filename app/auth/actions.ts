'use server'

import { redirect } from 'next/navigation'
import { authClient } from '@/lib/auth'
import { isUniversityEmail, safeNextPath } from '@/lib/signin'

export type SignInState = { error: string | null; sentTo?: string }

/**
 * Sign-in in two steps through one form: an email address gets a one-time code by
 * email, then the code signs in. A code rather than a link, because university mail
 * scanners open every link in a message, which spends a one-time link before the
 * student can click it.
 */
export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim()
  if (!isUniversityEmail(email)) {
    return { error: 'Use your @illinois.edu email address.' }
  }
  const supabase = (await authClient()).auth

  if (!formData.has('code')) {
    const { error } = await supabase.signInWithOtp({ email })
    if (error) {
      console.error('signIn: sending the code failed', error.message)
      return {
        error:
          error.status === 429
            ? 'Too many sign-in emails. Wait a minute and try again.'
            : 'Could not send the email. Try again.',
      }
    }
    return { error: null, sentTo: email }
  }

  const code = String(formData.get('code')).replace(/\s/g, '')
  const { error } = /^\d{6,10}$/.test(code)
    ? await supabase.verifyOtp({ email, token: code, type: 'email' })
    : { error: { message: 'not a code', status: 400 } }
  if (error) {
    console.error('signIn: verifying the code failed', error.message)
    return {
      sentTo: email,
      error:
        error.status === 429
          ? 'Too many attempts. Wait a minute and try again.'
          : 'That code is wrong or has expired. Check the latest email, or start over.',
    }
  }
  redirect(safeNextPath(String(formData.get('next') ?? '')))
}

export async function signOut() {
  await (await authClient()).auth.signOut()
  redirect('/')
}
