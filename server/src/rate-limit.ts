import { createHash, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
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
    keyGenerator: clientAddress(config.FRONTEND_SECRET),
    /**
     * Health checks decide whether an orchestrator kills this container, so
     * throttling them would turn a traffic spike into a restart loop.
     *
     * Matched on the routed path, not `request.url`: that carries the query
     * string, so a probe appending a cache-buster (`/healthz?probe=1`) would
     * miss an exact-equality check and be throttled during exactly the spike
     * this exemption exists for.
     */
    allowList: (request) => {
      const path = request.routeOptions?.url ?? request.url.split('?')[0]
      return path === '/healthz' || path === '/readyz'
    },
    /**
     * The plugin throws whatever this returns, so it must be an AppError. A
     * plain object has no top-level `message`, and the error handler would send
     * `message: undefined` — leaving this the only response in the API with no
     * message at all.
     */
    errorResponseBuilder: (_request, context) =>
      tooManyRequests(`Too many requests. Try again in ${context.after}.`),
  })
}

/**
 * The address a request is limited under.
 *
 * Normally the connecting address. The Next.js server is the exception: it
 * calls this API for every visitor, so keyed by its own address they would all
 * share one bucket and a busy minute would lock out the whole site. It proves
 * who it is with the shared secret and names the visitor in `x-client-ip`.
 *
 * Without the secret the header is ignored — otherwise any client could claim a
 * fresh address per request and never be limited. The comparison hashes both
 * sides first, so it runs in constant time regardless of length.
 */
function clientAddress(secret: string | undefined) {
  const expected = secret ? digest(secret) : null

  return (request: FastifyRequest): string => {
    if (!expected) return request.ip

    const presented = request.headers['x-frontend-secret']
    const forwarded = request.headers['x-client-ip']
    if (typeof presented !== 'string' || typeof forwarded !== 'string') return request.ip
    if (!timingSafeEqual(digest(presented), expected)) return request.ip

    const address = forwarded.trim()
    return isIP(address) ? address : request.ip
  }
}

const digest = (value: string) => createHash('sha256').update(value).digest()

type Bucket = { count: number; resetAt: number }

/** Hard ceiling on tracked accounts, so the map cannot grow without bound. */
const MAX_BUCKETS = 50_000

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

  function evict(now: number) {
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key)
    }
    // Sweeping only expired entries is not a bound: with more accounts active
    // inside one window than the cap, nothing expires and every request pays a
    // full scan that frees nothing. Drop the entries closest to expiry until
    // the map is within its ceiling.
    if (buckets.size > MAX_BUCKETS) {
      const byExpiry = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt)
      for (const [key] of byExpiry.slice(0, buckets.size - MAX_BUCKETS)) {
        buckets.delete(key)
      }
    }
  }

  /**
   * The bucket each request took its slot from. A refund goes back to that
   * bucket only, so a window that reset mid-request is not credited for a
   * slot it never handed out.
   */
  const reserved = new WeakMap<FastifyRequest, Bucket>()

  /**
   * Rejects an account at its ceiling; otherwise takes a slot immediately.
   *
   * Counting only after the response would let every request checked before
   * the first one finished through: a burst of parallel requests would all see
   * the same count. Reserving here closes that window, and `record` gives the
   * slot back if the write fails.
   */
  async function check(request: FastifyRequest, reply: FastifyReply) {
    // requireAuth runs first and has already rejected anonymous callers.
    const user = request.currentUser
    if (!user) return

    const now = Date.now()
    let bucket = buckets.get(user.id)
    if (bucket && now >= bucket.resetAt) {
      buckets.delete(user.id)
      bucket = undefined
    }
    if (bucket && bucket.count >= max) {
      const seconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
      reply.header('retry-after', String(seconds))
      throw tooManyRequests(
        `You have made too many changes. Try again in ${seconds} seconds.`
      )
    }

    if (bucket) {
      bucket.count += 1
    } else {
      if (buckets.size >= MAX_BUCKETS) evict(now)
      bucket = { count: 1, resetAt: now + windowMs }
      buckets.set(user.id, bucket)
    }
    reserved.set(request, bucket)
  }

  /**
   * Refunds the slot of a write that failed.
   *
   * Without this, two submissions failing validation would spend the budget,
   * and the author's first valid review would then be refused for the rest of
   * the window, having never written anything. Someone fighting a form error is
   * the most likely person to hit that, which is precisely the wrong person to
   * punish.
   */
  async function record(request: FastifyRequest, reply: FastifyReply) {
    const bucket = reserved.get(request)
    if (!bucket || reply.statusCode < 400) return
    reserved.delete(request)
    if (bucket.count > 0) bucket.count -= 1
  }

  return { check, record }
}

/**
 * Accepts "30 seconds", "1 minute", "2 hours", or a plain number of ms. The
 * format is validated in config.ts, so an unusable value is reported as the
 * configuration error it is rather than throwing while the app is built.
 *
 * Note this is narrower than the plugin's own `timeWindow` parser, which also
 * takes "1h"/"30s". Both settings are validated against this one grammar so
 * that the two windows cannot accept different syntaxes.
 */
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
