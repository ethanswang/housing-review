/**
 * Errors the API raises on purpose, carrying the status code and a stable
 * machine-readable code. Anything that is not an AppError is treated as a bug:
 * logged with its stack, reported to the client as a generic 500.
 */
export class AppError extends Error {
  statusCode: number
  code: string

  constructor(message: string, statusCode: number, code: string) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
  }
}

export const badRequest = (message: string, code = 'bad_request') =>
  new AppError(message, 400, code)

export const unauthorized = (message = 'Authentication required') =>
  new AppError(message, 401, 'unauthorized')

export const forbidden = (message = 'Not allowed') =>
  new AppError(message, 403, 'forbidden')

export const notFound = (message = 'Not found') =>
  new AppError(message, 404, 'not_found')

export const conflict = (message: string, code = 'conflict') =>
  new AppError(message, 409, code)

export const serviceUnavailable = (message = 'Service unavailable') =>
  new AppError(message, 503, 'service_unavailable')
