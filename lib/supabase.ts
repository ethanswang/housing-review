import 'server-only'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'Missing Supabase environment variables. Copy .env.example to .env.local and fill in ' +
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY from your Supabase project ' +
      'settings (Project Settings → API).'
  )
}

/**
 * The anon key is public by design — it is safe to expose because Row Level
 * Security (see supabase/schema.sql) is what actually decides who can read and
 * write. Never put the service_role key in this file; it bypasses RLS.
 *
 * The `server-only` import above is what keeps that true: importing this module
 * from a client component fails the build, so the key cannot reach a browser
 * bundle by accident.
 */
export const supabase = createClient(url, anonKey)
