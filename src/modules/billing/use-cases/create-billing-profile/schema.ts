import * as v from 'valibot'
import { CompanyInfoSchema, PricingSchema, UsageLimitsSchema } from '../../schemas.ts'

export const CreateBillingProfileBodySchema = v.object({
  company: v.object({ ...CompanyInfoSchema.entries, taxId: v.optional(v.nullable(v.string()), null) }),
  limits: v.object({ ...UsageLimitsSchema.entries, hardLimit: v.optional(v.boolean(), true) }),
  pricing: v.object({ ...PricingSchema.entries, includedUnits: v.optional(PricingSchema.entries.includedUnits, 0) }),
})

export type CreateBillingProfileInput = v.InferOutput<typeof CreateBillingProfileBodySchema>
