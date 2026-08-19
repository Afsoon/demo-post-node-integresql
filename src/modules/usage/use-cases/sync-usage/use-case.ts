import { DomainValidationError, NotFoundError } from '../../../../shared/errors.ts'
import type { BillingProfileRepository } from '../../../billing/domain/billing-profile-repository.ts'
import type { CustomerRepository } from '../../../customers/domain/customer-repository.ts'
import type { BillingProviderUsage } from '../../domain/billing-provider-usage.ts'
import type { Period } from '../../domain/usage-event.ts'
import type { UsageEventRepository } from '../../domain/usage-event-repository.ts'
import type { NewUsageSettlement, UsageSettlementRepository } from '../../domain/usage-settlement.ts'

type Deps = {
  usageEvents: UsageEventRepository
  usageSettlements: UsageSettlementRepository
  customers: Pick<CustomerRepository, 'findById'>
  billingProfiles: Pick<BillingProfileRepository, 'findByCustomerId'>
  billingProvider: BillingProviderUsage
}

const SYNC_BATCH = 500

/**
 * Forwards every not-yet-synced event of the period to the billing provider (meters),
 * then charges the synced quantity with an off-session order priced by the billing profile.
 * Events are marked synced as soon as the provider accepted them, so a retry never re-bills.
 *
 * Included units are intentionally not subtracted here: monthly allowances are the meter's job,
 * this path bills what was synced in the call.
 */
export function createSyncUsage({ usageEvents, usageSettlements, customers, billingProfiles, billingProvider }: Deps) {
  return async (customerId: string, period: Period) => {
    const customer = await customers.findById(customerId)
    if (!customer) throw new NotFoundError('customer', customerId)
    if (!customer.polarCustomerId) {
      throw new DomainValidationError('customer is not linked to the billing provider', { customerId })
    }

    let syncedEvents = 0
    // Quantities are numeric(18,6): accumulate in micro-units to avoid float drift over big batches
    let syncedMicroUnits = 0
    for (;;) {
      const batch = await usageEvents.findUnsynced(customerId, period, SYNC_BATCH)
      if (batch.length === 0) break
      await billingProvider.ingestEvents(batch.map((event) => ({ ...event, externalCustomerId: customerId })))
      await usageEvents.markSynced(batch, new Date())
      syncedEvents += batch.length
      syncedMicroUnits += batch.reduce((acc, e) => acc + Math.round(e.quantity * 1_000_000), 0)
      if (batch.length < SYNC_BATCH) break
    }
    const syncedQuantity = syncedMicroUnits / 1_000_000

    const profile = await billingProfiles.findByCustomerId(customerId)
    const unitPrice = profile && profile.pricing.plan !== 'free' ? profile.pricing.pricePerUnitCents : 0
    const amountCents = Math.round(syncedQuantity * unitPrice)

    const charge =
      profile && amountCents > 0
        ? {
            amountCents,
            currency: profile.pricing.currency,
            ...(await billingProvider.chargeUsage({
              providerCustomerId: customer.polarCustomerId,
              amountCents,
              currency: profile.pricing.currency,
              description: `${syncedQuantity} units (${period.start.toISOString()} – ${period.end.toISOString()})`,
              metadata: { customerId, syncedEvents, syncedQuantity },
            })),
          }
        : null

    const settlement: NewUsageSettlement = { customerId, period, syncedEvents, syncedQuantity, charge }
    return usageSettlements.insert(settlement)
  }
}

export type SyncUsage = ReturnType<typeof createSyncUsage>
