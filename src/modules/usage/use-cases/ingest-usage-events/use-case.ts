import { DomainValidationError } from '../../../../shared/errors.ts'
import type { CustomerRepository } from '../../../customers/domain/customer-repository.ts'
import { type UsageEvent, newUsageEvent } from '../../domain/usage-event.ts'
import type { UsageEventRepository } from '../../domain/usage-event-repository.ts'
import type { IngestUsageEventsInput, IngestUsageEventsResult } from './schema.ts'

type Deps = { usageEvents: UsageEventRepository; customers: Pick<CustomerRepository, 'findByIds'> }

type Rejected = IngestUsageEventsResult['rejected'][number]

/**
 * Partial-acceptance batch ingestion: every item is validated independently,
 * valid ones are stored (idempotently), the rest is reported back per index.
 */
export function createIngestUsageEvents({ usageEvents, customers }: Deps) {
  return async (items: IngestUsageEventsInput) => {
    const now = new Date()
    const rejected: Rejected[] = []
    const candidates: { index: number; event: UsageEvent }[] = []

    items.forEach((item, index) => {
      try {
        const event = newUsageEvent(
          { ...item, occurredAt: item.occurredAt === undefined ? undefined : new Date(item.occurredAt) },
          now,
        )
        candidates.push({ index, event })
      } catch (error) {
        if (!(error instanceof DomainValidationError)) throw error
        rejected.push({ index, eventId: item.eventId, reason: 'invalid', message: error.message })
      }
    })

    const customerIds = [...new Set(candidates.map((c) => c.event.customerId))]
    const known = new Set((await customers.findByIds(customerIds)).map((c) => c.id))

    const accepted: UsageEvent[] = []
    for (const { index, event } of candidates) {
      if (known.has(event.customerId)) accepted.push(event)
      else {
        rejected.push({
          index,
          eventId: event.eventId,
          reason: 'unknown_customer',
          message: `customer ${event.customerId} not found`,
        })
      }
    }

    const { inserted, duplicates } =
      accepted.length > 0 ? await usageEvents.insertMany(accepted) : { inserted: 0, duplicates: 0 }

    const result: IngestUsageEventsResult = {
      received: items.length,
      inserted,
      duplicates,
      rejected: rejected.sort((a, b) => a.index - b.index),
    }
    return result
  }
}
