import type { ErrorHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { AppError } from '../errors.ts'

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof AppError) {
    return c.json(
      { status: err.status, code: err.code, message: err.message, details: err.details },
      err.status as 400,
    )
  }
  if (err instanceof HTTPException) {
    // Middlewares like bearerAuth attach a fully built response (body + WWW-Authenticate)
    if (err.res) return err.getResponse()
    return c.json({ status: err.status, code: 'http_error', message: err.message }, err.status)
  }
  console.error(err)
  return c.json({ status: 500, code: 'internal_error', message: 'Internal server error' }, 500)
}
