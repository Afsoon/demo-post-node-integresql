import type { BillingProfileBody, BillingProfilePatch } from './types.ts'

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

export function billingProfileBody(overrides: DeepPartial<BillingProfileBody> = {}) {
  const body: BillingProfileBody = {
    company: {
      legalName: 'Ada Ltd',
      billingEmail: 'billing@ada.io',
      ...overrides.company,
      address: { line1: '1 Main St', city: 'London', postalCode: 'E1', country: 'gb', ...overrides.company?.address },
    },
    limits: { monthlyEventLimit: 10, rateLimitPerMinute: 60, ...overrides.limits },
    pricing: { plan: 'pro', currency: 'eur', pricePerUnitCents: 7, ...overrides.pricing },
  }
  return body
}

export function billingProfilePatch(overrides: BillingProfilePatch = {}) {
  const body: BillingProfilePatch = { limits: { rateLimitPerMinute: 120 }, ...overrides }
  return body
}
