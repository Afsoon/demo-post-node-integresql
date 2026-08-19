import * as v from 'valibot'
import { AddressSchema, CompanyInfoSchema, PricingSchema, UsageLimitsSchema } from '../../schemas.ts'

const notEmpty = <T extends Record<string, unknown>>(body: T) => Object.keys(body).length > 0

export const UpdateBillingProfileBodySchema = v.pipe(
  v.object({
    company: v.optional(
      v.partial(v.object({ ...CompanyInfoSchema.entries, address: v.partial(AddressSchema) })),
    ),
    limits: v.optional(v.partial(UsageLimitsSchema)),
    pricing: v.optional(v.partial(PricingSchema)),
  }),
  v.check(notEmpty, 'at least one section must be provided'),
)

export type UpdateBillingProfileInput = v.InferOutput<typeof UpdateBillingProfileBodySchema>
