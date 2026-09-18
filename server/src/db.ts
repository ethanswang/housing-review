import pg from 'pg'

/**
 * One pool per process. Timeouts are set deliberately: without
 * connectionTimeoutMillis a database outage makes requests hang until the
 * client gives up, which reads as "the site is down" rather than "the database
 * is down".
 */
export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  })
}

export type Database = pg.Pool
