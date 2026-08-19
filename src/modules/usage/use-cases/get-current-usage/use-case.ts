import { NotFoundError } from '../../../../shared/errors.ts'
import type { BillingProfileRepository } from '../../../billing/domain/billing-profile-repository.ts'
import type { CustomerRepository } from '../../../customers/domain/customer-repository.ts'
import { currentMonthPeriod } from '../../domain/usage-event.ts'
import type { UsageEventRepository } from '../../domain/usage-event-repository.ts'

type Deps = {
  usageEvents: UsageEventRepository
  customers: Pick<CustomerRepository, 'findById'>
  billingProfiles: Pick<BillingProfileRepository, 'findByCustomerId'>
}

export function createGetCurrentUsage({ usageEvents, customers, billingProfiles }: Deps) {
  return async (customerId: string, now = new Date()) => {
    const customer = await customers.findById(customerId)
    if (!customer) throw new NotFoundError('customer', customerId)

    const period = currentMonthPeriod(now)
    const [summary, profile] = await Promise.all([
      usageEvents.summarize(customerId, period),
      billingProfiles.findByCustomerId(customerId),
    ])

    const limit = profile
      ? {
          monthlyEventLimit: profile.limits.monthlyEventLimit,
          remaining: Math.max(0, profile.limits.monthlyEventLimit - summary.eventCount),
          hardLimit: profile.limits.hardLimit,
          exceeded: summary.eventCount > profile.limits.monthlyEventLimit,
        }
      : null

    return { customerId, period, summary, limit }
  }
}
