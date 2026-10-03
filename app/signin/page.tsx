import type { Metadata } from 'next'
import Link from 'next/link'
import { SignInForm } from '@/components/SignInForm'
import { currentUser } from '@/lib/auth'

export const metadata: Metadata = { title: 'Sign in — UIUC Housing Review' }

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  const [{ next, error }, user] = await Promise.all([searchParams, currentUser()])

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 md:px-6">
      <h1 className="text-display font-semibold tracking-tight">Sign in</h1>
      {user ? (
        <p className="mt-4 text-body">
          You are signed in as {user.email}. <Link href="/" className="underline">Browse buildings</Link>
        </p>
      ) : (
        <>
          <p className="mt-4 max-w-prose text-body text-ink-soft">
            Reviews are open to Illinois students. We email you a link instead of using a password,
            and only use your address to sign you in; it is never shown on the site.
          </p>
          {error === 'link' && (
            <p role="alert" className="mt-6 border-l-2 border-ink pl-3 text-body">
              That link did not work. It may have expired, been used already, or been opened in a
              different browser. Request a new one below.
            </p>
          )}
          <div className="mt-8">
            <SignInForm next={next} />
          </div>
        </>
      )}
    </div>
  )
}
