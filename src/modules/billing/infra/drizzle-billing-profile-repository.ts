import { eq } from 'drizzle-orm'
import type { Db } from '../../../infra/db/client.ts'
import { billingProfiles } from '../../../infra/db/schema/index.ts'
import { ConflictError } from '../../../shared/errors.ts'
import { isUniqueViolation } from '../../../shared/pg-errors.ts'
import type { BillingProfile, NewBillingProfile } from '../domain/billing-profile.ts'
import type { BillingProfileRepository } from '../domain/billing-profile-repository.ts'

type Row = typeof billingProfiles.$inferSelect

function toProfile(row: Row) {
  const profile: BillingProfile = {
    customerId: row.customerId,
    company: { legalName: row.legalName, taxId: row.taxId, billingEmail: row.billingEmail, address: row.address },
    limits: {
      monthlyEventLimit: row.monthlyEventLimit,
      rateLimitPerMinute: row.rateLimitPerMinute,
      hardLimit: row.hardLimit,
    },
    pricing: {
      plan: row.plan,
      currency: row.currency,
      pricePerUnitCents: row.pricePerUnitCents,
      includedUnits: row.includedUnits,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
  return profile
}

function toColumns(profile: NewBillingProfile) {
  return {
    customerId: profile.customerId,
    legalName: profile.company.legalName,
    taxId: profile.company.taxId,
    billingEmail: profile.company.billingEmail,
    address: profile.company.address,
    monthlyEventLimit: profile.limits.monthlyEventLimit,
    rateLimitPerMinute: profile.limits.rateLimitPerMinute,
    hardLimit: profile.limits.hardLimit,
    plan: profile.pricing.plan,
    currency: profile.pricing.currency,
    pricePerUnitCents: profile.pricing.pricePerUnitCents,
    includedUnits: profile.pricing.includedUnits,
  }
}

export function createDrizzleBillingProfileRepository(db: Db) {
  const repository: BillingProfileRepository = {
    async findByCustomerId(customerId) {
      const [row] = await db.select().from(billingProfiles).where(eq(billingProfiles.customerId, customerId)).limit(1)
      return row ? toProfile(row) : null
    },

    async insert(profile) {
      try {
        const [row] = await db.insert(billingProfiles).values(toColumns(profile)).returning()
        return toProfile(row!)
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictError(`billing profile for customer ${profile.customerId} already exists`, {
            customerId: profile.customerId,
          })
        }
        throw error
      }
    },

    async save(profile) {
      const { customerId, ...columns } = toColumns(profile)
      const [row] = await db
        .update(billingProfiles)
        .set({ ...columns, updatedAt: profile.updatedAt })
        .where(eq(billingProfiles.customerId, customerId))
        .returning()
      return toProfile(row!)
    },

    async delete(customerId) {
      const deleted = await db
        .delete(billingProfiles)
        .where(eq(billingProfiles.customerId, customerId))
        .returning({ customerId: billingProfiles.customerId })
      return deleted.length > 0
    },
  }
  return repository
}
