import { z } from 'zod'

/**
 * Configuration is read once, validated once, and fails loudly at boot rather
 * than surfacing as a confusing runtime error later. A container that starts
 * with a bad environment is worse than one that refuses to start.
 */
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
