// Refuses to run destructive work against anything that is not an obviously
// local database. `npm run db:seed` truncates every table, and DATABASE_URL is
// documented as the way to point these scripts elsewhere — so without this,
// one exported environment variable turns a seed into data loss.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db', 'postgres'])

export function assertLocalDatabase(connectionString, action) {
  if (process.env.ALLOW_DESTRUCTIVE === '1') return
  let host
  try {
    host = new URL(connectionString).hostname
  } catch {
    throw new Error(`Refusing to ${action}: DATABASE_URL is not a parseable URL.`)
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to ${action} against host "${host}".\n` +
        'This command is destructive and is meant for local development.\n' +
        'If you are certain, re-run with ALLOW_DESTRUCTIVE=1.'
    )
  }
}
