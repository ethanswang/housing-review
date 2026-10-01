// Prints the anon key for the e2e stack: an HS256 JWT with role "anon", signed
// with the stack's test-only PostgREST secret. Not a secret of any real project.
import { createHmac } from 'node:crypto'

const SECRET = 'e2e-only-jwt-secret-at-least-32-characters-long'
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'anon', iss: 'e2e' })}`
const signature = createHmac('sha256', SECRET).update(unsigned).digest('base64url')
process.stdout.write(`${unsigned}.${signature}`)
