import { z } from 'zod'

/**
 * Configuration is read once, validated once, and fails loudly at boot rather
 * than surfacing as a confusing runtime error later. A container that starts
 * with a bad environment is worse than one that refuses to start.
 */
/**
 * A time window, as "30 seconds" / "5 minutes" / "1 hour", or milliseconds.
 * Validated here so a typo is reported as the configuration error it is, at
 * boot, rather than throwing from inside the limiter while the app is built.
 */
const WINDOW = /^(\d+\s*(second|minute|hour|day)s?|\d+)$/i
const window = () =>
  z.string().refine((value) => WINDOW.test(value.trim()), 'must be like "1 minute", "2 hours", or a number of milliseconds')

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().max(65535).default(3001),
  // URL.canParse alone is far too permissive: it accepts 'hello:world' and
  // 'localhost:5432'. Checking the protocol is what catches the mistakes that
  // actually happen — a missing scheme, or 'postgress://'.
  DATABASE_URL: z.string().refine((value) => {
    if (!URL.canParse(value)) return false
    const { protocol } = new URL(value)
    return protocol === 'postgres:' || protocol === 'postgresql:'
  }, 'must be a postgres:// or postgresql:// connection URL'),
  // How many proxy hops to trust for X-Forwarded-For. Trusting *any* peer lets
  // a client forge its own IP, which hands out a fresh rate-limit bucket per
  // forged value and poisons audit logs.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  // Supabase Auth issues the tokens this service verifies. The JWKS URL and the
  // issuer are both derived from it, so there is one value to get right rather
  // than three that can disagree.
  SUPABASE_URL: z
    .string()
    .refine((value) => {
      if (!URL.canParse(value)) return false
      return new URL(value).protocol === 'https:'
    }, 'must be an https:// project URL')
    // A trailing slash would produce '//auth/v1' once the paths are appended.
    .transform((value) => value.replace(/\/+$/, '')),
  SUPABASE_JWT_AUDIENCE: z.string().default('authenticated'),
  // Per-IP ceiling on all traffic. Deliberately generous: a university campus
  // sits behind a handful of NAT addresses, so hundreds of students share an
  // IP and a tight limit here would lock out a lecture hall, not an attacker.
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
  RATE_LIMIT_WINDOW: window().default('1 minute'),
  // Writes are limited per authenticated user instead, which is why the hook
  // runs after requireAuth. Nobody writes twenty reviews an hour honestly.
  RATE_LIMIT_WRITE_MAX: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_WRITE_WINDOW: window().default('1 hour'),
})

export type Config = z.infer<typeof schema> & {
  /** Where Supabase publishes the public keys for its ES256 signatures. */
  supabaseJwksUrl: string
  /** The `iss` claim every accepted token must carry. */
  supabaseIssuer: string
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env)
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid environment:\n${detail}`)
  }
  return {
    ...result.data,
    supabaseJwksUrl: `${result.data.SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
    supabaseIssuer: `${result.data.SUPABASE_URL}/auth/v1`,
  }
}
