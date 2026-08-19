import * as v from 'valibot'
import { IsoDateTimeSchema, UuidSchema } from '../../shared/http/schemas.ts'
import { type BillingProfile, billingPlans } from './domain/billing-profile.ts'

export const BillingPlanSchema = v.picklist(billingPlans)

export const AddressSchema = v.object({
  line1: v.pipe(v.string(), v.minLength(1)),
  line2: v.optional(v.string()),
  city: v.pipe(v.string(), v.minLength(1)),
  postalCode: v.pipe(v.string(), v.minLength(1)),
  state: v.optional(v.string()),
  country: v.pipe(v.string(), v.length(2), v.description('ISO 3166-1 alpha-2')),
})

export const CompanyInfoSchema = v.object({
  legalName: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  taxId: v.nullable(v.string()),
  billingEmail: v.pipe(v.string(), v.email()),
  address: AddressSchema,
})

export const UsageLimitsSchema = v.object({
  monthlyEventLimit: v.pipe(v.number(), v.integer(), v.minValue(1)),
  rateLimitPerMinute: v.pipe(v.number(), v.integer(), v.minValue(1)),
  hardLimit: v.boolean(),
})

export const PricingSchema = v.object({
  plan: BillingPlanSchema,
  currency: v.pipe(v.string(), v.length(3), v.description('ISO 4217')),
  pricePerUnitCents: v.pipe(v.number(), v.integer(), v.minValue(0)),
  includedUnits: v.pipe(v.number(), v.integer(), v.minValue(0)),
})

export const BillingProfileSchema = v.object({
  customerId: UuidSchema,
  company: CompanyInfoSchema,
  limits: UsageLimitsSchema,
  pricing: PricingSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
})

export function toBillingProfileResponse(profile: BillingProfile) {
  const response: v.InferOutput<typeof BillingProfileSchema> = {
    ...profile,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  }
  return response
}
