import type { UsageEvent } from './usage-event.ts'

export type ProviderUsageEvent = UsageEvent & {
  /** Our customer id, which is the provider-side external id. */
  externalCustomerId: string
}

export type ChargeInput = {
  providerCustomerId: string
  amountCents: number
  /** ISO 4217 */
  currency: string
  description: string
  metadata?: Record<string, string | number | boolean>
}

export type ChargeResult = { orderId: string; status: string }

/** Port: usage-side of the billing provider (Polar meters + off-session orders). */
export interface BillingProviderUsage {
  ingestEvents(events: ProviderUsageEvent[]): Promise<{ inserted: number; duplicates: number }>
  chargeUsage(input: ChargeInput): Promise<ChargeResult>
}
