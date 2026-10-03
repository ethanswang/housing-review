'use client'

import { useActionState, useEffect, useRef } from 'react'
import { sendSignInLink, type SignInState } from '@/app/auth/actions'

const initialState: SignInState = { error: null }

export function SignInForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(sendSignInLink, initialState)
  const formRef = useRef<HTMLFormElement>(null)

  // For the e2e tests (e2e/helpers.ts): effects run only once React has hydrated.
  useEffect(() => {
    formRef.current?.setAttribute('data-hydrated', '')
  }, [])

  if (state.sentTo) {
    return (
      <div role="status" className="border-t border-rule py-6">
        <p className="text-title font-semibold">Check your email</p>
        <p className="mt-1 text-body text-ink-soft">
          We sent a sign-in link to {state.sentTo}. Open it in this browser; it expires in an hour.
        </p>
      </div>
    )
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next ?? ''} />
      <label className="flex flex-col gap-2">
        <span className="text-body font-semibold">Illinois email</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="netid@illinois.edu"
          className="h-12 rounded-lg border border-rule-strong bg-surface px-4 text-body md:max-w-sm"
        />
      </label>
      {state.error && (
        <p role="alert" className="border-l-2 border-ink pl-3 text-body">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="h-12 rounded-lg bg-accent px-6 text-body font-semibold text-surface transition-colors hover:bg-accent-dark disabled:opacity-50 md:self-start"
      >
        {pending ? 'Sending…' : 'Email me a sign-in link'}
      </button>
    </form>
  )
}
