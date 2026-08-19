import { bearerAuth } from 'hono/bearer-auth'

const unauthorized = (message: string, status = 401) => ({ status, code: 'unauthorized', message })

/**
 * Static bearer token auth (token from env). hono's bearerAuth compares with a
 * timing-safe equality check and sets the WWW-Authenticate header.
 */
export function createBearerAuth(token: string) {
  return bearerAuth({
    token,
    noAuthenticationHeaderMessage: unauthorized('Missing Authorization header'),
    // hono answers 400 for a malformed header
    invalidAuthenticationHeaderMessage: unauthorized('Malformed Authorization header, expected: Bearer <token>', 400),
    invalidTokenMessage: unauthorized('Invalid token'),
  })
}
