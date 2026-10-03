'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { authClient } from '@/lib/auth'
import { NEXT_COOKIE, isUniversityEmail, safeNextPath } from '@/lib/signin'

export type SignInState = { error: string | null; sentTo?: string }

export async function sendSignInLink(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim()
  if (!isUniversityEmail(email)) {
    return { error: 'Use your @illinois.edu email address.' }
  }

  // Next.js only runs a Server Action whose Origin matches the site, so this is our
  // own address; Supabase also refuses redirects outside its allow list.
  const origin = (await headers()).get('origin')
  const { error } = await (await authClient()).auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  })
  if (error) {
    console.error('sendSignInLink failed', error.message)
    return {
      error:
        error.status === 429
          ? 'Too many sign-in emails. Wait a minute and try again.'
          : 'Could not send the email. Try again.',
    }
  }

  ;(await cookies()).set(NEXT_COOKIE, safeNextPath(String(formData.get('next') ?? '')), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60,
  })
  return { error: null, sentTo: email }
}

export async function signOut() {
  await (await authClient()).auth.signOut()
  redirect('/')
}
