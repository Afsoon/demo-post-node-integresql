import { integer, jsonb, snakeCase, text, timestamp } from 'drizzle-orm/pg-core'

export type IdempotencyStatus = 'processing' | 'completed'

/** Stored responses for idempotent webhook calls (x-idempotency-id), valid until expires_at. */
export const webhookIdempotencyKeys = snakeCase.table('webhook_idempotency_keys', {
  key: text().primaryKey(),
  requestHash: text().notNull(),
  status: text().$type<IdempotencyStatus>().notNull(),
  responseStatus: integer(),
  responseBody: jsonb(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
})
