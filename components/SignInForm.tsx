'use client'

import { useActionState, useEffect, useRef } from 'react'
import { signIn, type SignInState } from '@/app/auth/actions'

const initialState: SignInState = { error: null }
const inputClass = 'h-12 border border-rule-strong bg-surface px-4 text-body md:max-w-sm'
const buttonClass =
  'h-12 bg-accent px-6 text-body font-semibold text-surface transition-colors hover:bg-accent-dark disabled:opacity-50 md:self-start'

export function SignInForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(signIn, initialState)
  const root = useRef<HTMLDivElement>(null)

  // For the e2e tests (e2e/helpers.ts): effects run only once React has hydrated.
  useEffect(() => {
    root.current?.setAttribute('data-hydrated', '')
  }, [])

  return (
    <div ref={root}>
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next ?? ''} />
        {state.sentTo ? (
          <>
            <input type="hidden" name="email" value={state.sentTo} />
            <p role="status" className="text-body text-ink-soft">
              We emailed a sign-in code to {state.sentTo}. It works once, and only for a short while.
            </p>
            <label className="flex flex-col gap-2">
              <span className="text-body font-semibold">Code</span>
              <input
                name="code"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]*"
                className={`${inputClass} tracking-widest`}
              />
            </label>
          </>
        ) : (
          <label className="flex flex-col gap-2">
            <span className="text-body font-semibold">Illinois email</span>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              placeholder="netid@illinois.edu"
              className={inputClass}
            />
          </label>
        )}
        {state.error && (
          <p role="alert" className="border-l-2 border-ink pl-3 text-body">
            {state.error}
          </p>
        )}
        <button type="submit" disabled={pending} className={buttonClass}>
          {state.sentTo ? (pending ? 'Signing in…' : 'Sign in') : pending ? 'Sending…' : 'Email me a code'}
        </button>
      </form>
      {state.sentTo && (
        // A fresh page resets the form to the email step.
        <a href={next ? `/signin?next=${encodeURIComponent(next)}` : '/signin'} className="mt-4 inline-block text-meta underline">
          Use a different address
        </a>
      )}
    </div>
  )
}
