import { snakeCase, text } from 'drizzle-orm/pg-core'

/**
 * Lookup tables instead of PG enums: adding a value is an INSERT, not an ALTER TYPE.
 * Seeds live in the migration that created each table.
 */
export const customerTypes = snakeCase.table('customer_types', {
  code: text().primaryKey(),
  label: text().notNull(),
})

export const customerStatuses = snakeCase.table('customer_statuses', {
  code: text().primaryKey(),
  label: text().notNull(),
})

export const billingPlans = snakeCase.table('billing_plans', {
  code: text().primaryKey(),
  label: text().notNull(),
})
