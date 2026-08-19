import { sql } from 'drizzle-orm'
import { char, index, integer, numeric, snakeCase, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/** Audit row per "sync usage to Polar + charge" run (endpoint or customer deletion). */
export const usageSettlements = snakeCase.table(
  'usage_settlements',
  {
    id: uuid().primaryKey().default(sql`uuidv7()`),
    customerId: uuid().notNull(),
    periodStart: timestamp({ withTimezone: true }).notNull(),
    periodEnd: timestamp({ withTimezone: true }).notNull(),
    syncedEvents: integer().notNull(),
    syncedQuantity: numeric({ precision: 18, scale: 6 }).notNull(),
    amountCents: integer().notNull().default(0),
    currency: char({ length: 3 }),
    polarOrderId: text(),
    polarOrderStatus: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('usage_settlements_customer_idx').on(t.customerId, t.createdAt)],
)
