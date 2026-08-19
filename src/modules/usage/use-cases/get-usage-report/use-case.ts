import { NotFoundError } from '../../../../shared/errors.ts'
import type { CustomerRepository } from '../../../customers/domain/customer-repository.ts'
import type { Period } from '../../domain/usage-event.ts'
import type { UsageEventRepository } from '../../domain/usage-event-repository.ts'
import type { UsageReportInput } from './schema.ts'

type Deps = { usageEvents: UsageEventRepository; customers: Pick<CustomerRepository, 'findById'> }

export function createGetUsageReport({ usageEvents, customers }: Deps) {
  return async (customerId: string, input: UsageReportInput) => {
    const customer = await customers.findById(customerId)
    if (!customer) throw new NotFoundError('customer', customerId)

    const period: Period = { start: new Date(input.start), end: new Date(input.end) }
    const [totals, series] = await Promise.all([
      usageEvents.summarize(customerId, period),
      usageEvents.series(customerId, period, input.bucket),
    ])
    return { customerId, period, bucket: input.bucket, totals, series }
  }
}
