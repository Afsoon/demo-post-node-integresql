import { sql } from 'drizzle-orm'
import { jsonb, snakeCase, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { customerStatuses, customerTypes } from './lookups.ts'

export type CustomerTypeCode = 'individual' | 'team'
export type CustomerStatusCode = 'active' | 'suspended'

export const customers = snakeCase.table('customers', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  email: text().notNull().unique(),
  name: text().notNull(),
  type: text()
    .$type<CustomerTypeCode>()
    .notNull()
    .references(() => customerTypes.code),
  status: text()
    .$type<CustomerStatusCode>()
    .notNull()
    .default('active')
    .references(() => customerStatuses.code),
  polarCustomerId: text().unique(),
  metadata: jsonb().$type<Record<string, string | number | boolean>>().notNull().default({}),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})
