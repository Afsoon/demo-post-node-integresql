import { createHash } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'

export type IdempotencyBegin =
  | { kind: 'started' }
  | { kind: 'replay'; status: number; body: unknown }
  | { kind: 'in_progress' }
  | { kind: 'mismatch' }

/** Port: persistence of idempotency keys. Implemented with drizzle in src/infra/idempotency. */
export interface IdempotencyStore {
  /** Claims the key (or reports what is already stored for it). Expired rows count as absent. */
  begin(key: string, requestHash: string, expiresAt: Date): Promise<IdempotencyBegin>
  complete(key: string, responseStatus: number, responseBody: unknown): Promise<void>
  /** Frees a claimed key after a failure so the caller can retry. */
  release(key: string): Promise<void>
  purgeExpired(now?: Date): Promise<number>
}

export type IdempotencyOptions = {
  store: IdempotencyStore
  /** Default 72h */
  ttlMs?: number
  header?: string
}

export const IDEMPOTENCY_HEADER = 'x-idempotency-id'
export const IDEMPOTENCY_TTL_MS = 72 * 60 * 60 * 1000
const MAX_KEY_LENGTH = 200

const errorJson = (status: number, code: string, message: string) =>
  Response.json({ status, code, message }, { status })

function hashBody(text: string) {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * Idempotent request handling keyed by `x-idempotency-id`:
 * same key + same body within the TTL → stored response replayed (Idempotent-Replayed: true),
 * same key + different body → 422, key still being processed → 409, missing key → 400.
 */
export function idempotency({ store, ttlMs = IDEMPOTENCY_TTL_MS, header = IDEMPOTENCY_HEADER }: IdempotencyOptions) {
  const middleware: MiddlewareHandler = async (c, next) => {
    const key = c.req.header(header)?.trim()
    if (!key || key.length > MAX_KEY_LENGTH) {
      throw new HTTPException(400, {
        res: errorJson(400, 'validation_error', `${header} header is required (1-${MAX_KEY_LENGTH} chars)`),
      })
    }

    // Hono caches the body, so validators downstream can still call c.req.json()
    const requestHash = hashBody(await c.req.text())
    const claim = await store.begin(key, requestHash, new Date(Date.now() + ttlMs))

    switch (claim.kind) {
      case 'replay':
        return Response.json(claim.body, { status: claim.status, headers: { 'Idempotent-Replayed': 'true' } })
      case 'in_progress':
        throw new HTTPException(409, {
          res: errorJson(409, 'conflict', `request with ${header} ${key} is still being processed`),
        })
      case 'mismatch':
        throw new HTTPException(422, {
          res: errorJson(422, 'idempotency_mismatch', `${header} ${key} was already used with a different body`),
        })
      case 'started':
        break
    }

    try {
      await next()
    } catch (error) {
      await store.release(key)
      throw error
    }

    // Only JSON responses are stored; anything else (or a 5xx) frees the key for a retry.
    const isJson = c.res.headers.get('content-type')?.includes('application/json') ?? false
    if (c.res.status >= 500 || !isJson) {
      await store.release(key)
      return
    }
    await store.complete(key, c.res.status, await c.res.clone().json())
  }
  return middleware
}
