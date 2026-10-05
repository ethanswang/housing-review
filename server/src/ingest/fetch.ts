/**
 * GET with a timeout and three tries, backing off, for network errors and 5xx.
 * ArcGIS and Socrata report some failures as 200 with an `error` body, so that
 * counts too.
 */
export async function getJson(url: string): Promise<unknown> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (response.status >= 500) throw new Error(`HTTP ${response.status}`)
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { fatal: true })
      const body = (await response.json()) as { error?: { message?: string } | boolean; message?: string }
      if (body && !Array.isArray(body) && body.error) {
        throw new Error(`Source error: ${(typeof body.error === 'object' && body.error.message) || body.message || 'unknown'}`)
      }
      return body
    } catch (error) {
      if ((error as { fatal?: boolean }).fatal) throw error
      lastError = error
    }
  }
  throw new Error(`Could not fetch ${url}: ${(lastError as Error)?.message}`)
}
