import { and, eq, lte, sql } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { webhookIdempotencyKeys } from '../db/schema/index.ts'
import type { IdempotencyStore } from '../../shared/http/idempotency.ts'

export function createDrizzleIdempotencyStore(db: Db) {
  const store: IdempotencyStore = {
    async begin(key, requestHash, expiresAt) {
      // Single atomic statement: insert, or take over an expired row. If the row is live the
      // DO UPDATE ... WHERE clause is false and nothing is returned → read it to decide.
      const [claimed] = await db
        .insert(webhookIdempotencyKeys)
        .values({ key, requestHash, status: 'processing', expiresAt })
        .onConflictDoUpdate({
          target: webhookIdempotencyKeys.key,
          set: {
            requestHash,
            status: 'processing',
            responseStatus: null,
            responseBody: null,
            createdAt: sql`now()`,
            expiresAt,
          },
          setWhere: lte(webhookIdempotencyKeys.expiresAt, sql`now()`),
        })
        .returning({ key: webhookIdempotencyKeys.key })
      if (claimed) return { kind: 'started' }

      const [existing] = await db
        .select()
        .from(webhookIdempotencyKeys)
        .where(eq(webhookIdempotencyKeys.key, key))
        .limit(1)
      if (!existing) return { kind: 'started' } // raced with a purge; extremely unlikely, treat as fresh
      if (existing.requestHash !== requestHash) return { kind: 'mismatch' }
      if (existing.status === 'processing') return { kind: 'in_progress' }
      return { kind: 'replay', status: existing.responseStatus ?? 200, body: existing.responseBody }
    },

    async complete(key, responseStatus, responseBody) {
      await db
        .update(webhookIdempotencyKeys)
        .set({ status: 'completed', responseStatus, responseBody })
        .where(eq(webhookIdempotencyKeys.key, key))
    },

    async release(key) {
      await db
        .delete(webhookIdempotencyKeys)
        .where(and(eq(webhookIdempotencyKeys.key, key), eq(webhookIdempotencyKeys.status, 'processing')))
    },

    async purgeExpired(now = new Date()) {
      const deleted = await db
        .delete(webhookIdempotencyKeys)
        .where(lte(webhookIdempotencyKeys.expiresAt, now))
        .returning({ key: webhookIdempotencyKeys.key })
      return deleted.length
    },
  }
  return store
}
