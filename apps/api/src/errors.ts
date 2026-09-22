/** Errors the route layer throws and the error handler turns into JSON. */

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export const badRequest = (message: string, details?: unknown): HttpError =>
  new HttpError(400, 'bad_request', message, details)

export const unauthorized = (message = 'Sign in to continue'): HttpError =>
  new HttpError(401, 'unauthorized', message)

export const forbidden = (message = 'Grown-ups only'): HttpError =>
  new HttpError(403, 'forbidden', message)

export const notFound = (what: string): HttpError =>
  new HttpError(404, 'not_found', `${what} not found`)

export const conflict = (message: string): HttpError => new HttpError(409, 'conflict', message)

export const unavailable = (message: string): HttpError =>
  new HttpError(503, 'service_unavailable', message)
