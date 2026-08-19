import * as v from 'valibot'
import { parseEntity } from '../../../shared/domain/parse-entity.ts'

export const billingPlans = ['free', 'pro', 'enterprise'] as const
export type BillingPlan = (typeof billingPlans)[number]

export const AddressSchema = v.object({
  line1: v.pipe(v.string(), v.trim(), v.nonEmpty()),
  line2: v.optional(v.string()),
  city: v.pipe(v.string(), v.trim(), v.nonEmpty()),
  postalCode: v.pipe(v.string(), v.trim(), v.nonEmpty()),
  state: v.optional(v.string()),
  country: v.pipe(v.string(), v.trim(), v.toUpperCase(), v.length(2, 'country must be ISO 3166-1 alpha-2')),
})

export const CompanyInfoSchema = v.object({
  legalName: v.pipe(v.string(), v.trim(), v.nonEmpty('legalName is required'), v.maxLength(200)),
  taxId: v.pipe(
    v.nullable(v.string()),
    v.transform((value) => value?.trim() || null),
  ),
  billingEmail: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.nonEmpty('billingEmail is required'), v.email()),
  address: AddressSchema,
})

export const UsageLimitsSchema = v.object({
  monthlyEventLimit: v.pipe(v.number(), v.integer(), v.minValue(1, 'monthlyEventLimit must be a positive integer')),
  rateLimitPerMinute: v.pipe(v.number(), v.integer(), v.minValue(1, 'rateLimitPerMinute must be a positive integer')),
  /** true → reject events above the limit, false → allow and bill overage */
  hardLimit: v.boolean(),
})

export const PricingSchema = v.object({
  plan: v.picklist(billingPlans),
  currency: v.pipe(v.string(), v.trim(), v.toUpperCase(), v.length(3, 'currency must be ISO 4217 (3 letters)')),
  pricePerUnitCents: v.pipe(v.number(), v.integer(), v.minValue(0, 'pricePerUnitCents cannot be negative')),
  includedUnits: v.pipe(v.number(), v.integer(), v.minValue(0, 'includedUnits cannot be negative')),
})

const ProfileCoreSchema = v.object({
  customerId: v.pipe(v.string(), v.uuid()),
  company: CompanyInfoSchema,
  limits: UsageLimitsSchema,
  pricing: PricingSchema,
})

type ProfileLike = { limits: v.InferOutput<typeof UsageLimitsSchema>; pricing: v.InferOutput<typeof PricingSchema> }

/** Cross-field invariants shared by new and existing profiles. */
const freePlanHasNoPrice = (p: ProfileLike) => p.pricing.plan !== 'free' || p.pricing.pricePerUnitCents === 0
const includedUnitsWithinLimit = (p: ProfileLike) => p.pricing.includedUnits <= p.limits.monthlyEventLimit

export const NewBillingProfileSchema = v.pipe(
  ProfileCoreSchema,
  v.forward(v.check((p) => freePlanHasNoPrice(p), 'free plan cannot have a unit price'), ['pricing', 'pricePerUnitCents']),
  v.forward(
    v.check((p) => includedUnitsWithinLimit(p), 'includedUnits cannot exceed limits.monthlyEventLimit'),
    ['pricing', 'includedUnits'],
  ),
)

export const BillingProfileSchema = v.pipe(
  v.object({ ...ProfileCoreSchema.entries, createdAt: v.date(), updatedAt: v.date() }),
  v.forward(v.check((p) => freePlanHasNoPrice(p), 'free plan cannot have a unit price'), ['pricing', 'pricePerUnitCents']),
  v.forward(
    v.check((p) => includedUnitsWithinLimit(p), 'includedUnits cannot exceed limits.monthlyEventLimit'),
    ['pricing', 'includedUnits'],
  ),
)

export type CompanyInfo = v.InferOutput<typeof CompanyInfoSchema>
export type UsageLimits = v.InferOutput<typeof UsageLimitsSchema>
export type Pricing = v.InferOutput<typeof PricingSchema>
export type BillingProfile = v.InferOutput<typeof BillingProfileSchema>
export type NewBillingProfile = v.InferOutput<typeof NewBillingProfileSchema>

export type BillingProfilePatch = {
  company?: Partial<Omit<CompanyInfo, 'address'>> & { address?: Partial<CompanyInfo['address']> }
  limits?: Partial<UsageLimits>
  pricing?: Partial<Pricing>
}

export function newBillingProfile(input: v.InferInput<typeof NewBillingProfileSchema>) {
  return parseEntity(NewBillingProfileSchema, input)
}

export function applyBillingProfilePatch(profile: BillingProfile, patch: BillingProfilePatch) {
  return parseEntity(BillingProfileSchema, {
    ...profile,
    company: {
      ...profile.company,
      ...patch.company,
      address: { ...profile.company.address, ...patch.company?.address },
    },
    limits: { ...profile.limits, ...patch.limits },
    pricing: { ...profile.pricing, ...patch.pricing },
    updatedAt: new Date(),
  })
}
