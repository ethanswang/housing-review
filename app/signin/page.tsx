import type { Metadata } from 'next'
import Link from 'next/link'
import { SignInForm } from '@/components/SignInForm'
import { currentUser } from '@/lib/auth'

export const metadata: Metadata = { title: 'Sign in — UIUC Housing Review' }

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const [{ next }, user] = await Promise.all([searchParams, currentUser()])

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
            Reviews are open to Illinois students. We email you a code instead of using a password,
            and only use your address to sign you in; it is never shown on the site. See{' '}
            <Link href="/policies#privacy" className="underline">privacy</Link>.
          </p>
          <div className="mt-8">
            <SignInForm next={next} />
          </div>
        </>
      )}
    </div>
  )
}
