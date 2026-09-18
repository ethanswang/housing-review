import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import type { Config } from './config.ts'
import { tooManyRequests } from './errors.ts'

/**
 * Two ceilings, because the two kinds of abuse look different.
 *
 * Reading is limited per IP, generously. A campus sits behind a handful of NAT
 * addresses, so hundreds of students share one: a tight per-IP limit would lock
 * out a lecture hall while barely inconveniencing anyone on a phone hotspot.
 * Its job is to stop crude flooding, not to be clever.
 *
 * Writing is limited per authenticated account, which is the identity that
 * actually costs something to obtain — it needs a verified @illinois.edu
 * address.
 */
export async function registerRateLimits(app: FastifyInstance, config: Config) {
  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW,
    // Health checks decide whether an orchestrator kills this container.
    // Throttling them would turn a traffic spike into a restart loop.
    allowList: (request) => request.url === '/healthz' || request.url === '/readyz',
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: { code: 'rate_limited', message: `Too many requests. Try again in ${context.after}.` },
    }),
  })
}

type Bucket = { count: number; resetAt: number }

/**
 * A fixed-window counter keyed by account.
 *
 * Written by hand rather than with @fastify/rate-limit, because that plugin
 * only enforces from an `onRequest` hook — which runs before authentication, so
 * the account is not known yet. Verified: its limiter used as a `preHandler`
 * counts nothing and lets every request through. Keying by IP instead would
 * mean one student could exhaust the budget for everyone on campus wifi.
 *
 * The counter lives in this process, so N instances allow N times the limit.
 * That is the same tradeoff the plugin's default store makes, and it is
 * acceptable while this runs as a single service; a shared store is the fix
 * when it does not.
 */
export function createWriteLimiter(config: Config) {
  const windowMs = parseWindow(config.RATE_LIMIT_WRITE_WINDOW)
  const max = config.RATE_LIMIT_WRITE_MAX
  const buckets = new Map<string, Bucket>()

  function sweep(now: number) {
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key)
    }
  }

  return async function writeLimit(request: FastifyRequest, reply: FastifyReply) {
    // requireAuth runs first and has already rejected anonymous callers; this
    // is a guard, not a fallback to IP-keyed limiting.
    const user = request.currentUser
    if (!user) return

    const now = Date.now()
    // Bounded memory: one entry per account that wrote inside the window.
    if (buckets.size > 10_000) sweep(now)

    const bucket = buckets.get(user.id)
    if (!bucket || now >= bucket.resetAt) {
      buckets.set(user.id, { count: 1, resetAt: now + windowMs })
      return
    }

    bucket.count += 1
    if (bucket.count > max) {
      const seconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
      reply.header('retry-after', String(seconds))
      throw tooManyRequests(
        `You have submitted too many reviews. Try again in ${seconds} seconds.`
      )
    }
  }
}

/** Accepts "30 seconds", "1 minute", "2 hours", or a plain number of ms. */
function parseWindow(value: string): number {
  const asNumber = Number(value)
  if (Number.isFinite(asNumber) && asNumber > 0) return asNumber

  const match = /^(\d+)\s*(second|minute|hour|day)s?$/i.exec(value.trim())
  if (!match) throw new Error(`Unrecognised rate limit window: "${value}"`)
  const amount = Number(match[1])
  const unit = match[2]!.toLowerCase()
  const ms = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000 }[unit]!
  return amount * ms
}
