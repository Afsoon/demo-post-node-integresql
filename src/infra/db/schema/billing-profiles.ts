import { boolean, char, integer, jsonb, snakeCase, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { customers } from './customers.ts'
import { billingPlans } from './lookups.ts'

export type BillingPlanCode = 'free' | 'pro' | 'enterprise'

export type BillingAddress = {
  line1: string
  line2?: string
  city: string
  postalCode: string
  state?: string
  country: string
}

export const billingProfiles = snakeCase.table('billing_profiles', {
  customerId: uuid()
    .primaryKey()
    .references(() => customers.id, { onDelete: 'cascade' }),
  // company information
  legalName: text().notNull(),
  taxId: text(),
  billingEmail: text().notNull(),
  address: jsonb().$type<BillingAddress>().notNull(),
  // limits
  monthlyEventLimit: integer().notNull(),
  rateLimitPerMinute: integer().notNull(),
  hardLimit: boolean().notNull().default(true),
  // pricing
  plan: text()
    .$type<BillingPlanCode>()
    .notNull()
    .references(() => billingPlans.code),
  currency: char({ length: 3 }).notNull(),
  pricePerUnitCents: integer().notNull(),
  includedUnits: integer().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})
