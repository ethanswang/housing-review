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
  DATABASE_URL: z
    .string()
    .refine((value) => URL.canParse(value), 'must be a valid connection URL'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
})

export type Config = z.infer<typeof schema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env)
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid environment:\n${detail}`)
  }
  return result.data
}
