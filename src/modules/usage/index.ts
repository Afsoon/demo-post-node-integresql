import type { Db } from '../../infra/db/client.ts'
import type { BillingProfileRepository } from '../billing/domain/billing-profile-repository.ts'
import type { CustomerRepository } from '../customers/domain/customer-repository.ts'
import type { BillingProviderUsage } from './domain/billing-provider-usage.ts'
import { createDrizzleUsageEventRepository } from './infra/drizzle-usage-event-repository.ts'
import { createDrizzleUsageSettlementRepository } from './infra/drizzle-usage-settlement-repository.ts'
import { createGetCurrentUsage } from './use-cases/get-current-usage/use-case.ts'
import { createGetUsageReport } from './use-cases/get-usage-report/use-case.ts'
import { createIngestUsageEvents } from './use-cases/ingest-usage-events/use-case.ts'
import { createSyncUsage } from './use-cases/sync-usage/use-case.ts'

export type UsageModuleDeps = {
  db: Db
  customers: Pick<CustomerRepository, 'findById' | 'findByIds'>
  billingProfiles: Pick<BillingProfileRepository, 'findByCustomerId'>
  billingProvider: BillingProviderUsage
}

/** Wires the usage module: hypertable + settlement repositories and use cases. */
export function createUsageModule({ db, customers, billingProfiles, billingProvider }: UsageModuleDeps) {
  const usageEvents = createDrizzleUsageEventRepository(db)
  const usageSettlements = createDrizzleUsageSettlementRepository(db)
  return {
    repository: usageEvents,
    settlements: usageSettlements,
    ingest: createIngestUsageEvents({ usageEvents, customers }),
    current: createGetCurrentUsage({ usageEvents, customers, billingProfiles }),
    report: createGetUsageReport({ usageEvents, customers }),
    sync: createSyncUsage({ usageEvents, usageSettlements, customers, billingProfiles, billingProvider }),
  }
}

export type UsageModule = ReturnType<typeof createUsageModule>
