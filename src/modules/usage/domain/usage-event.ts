import * as v from 'valibot'
import { MetadataSchema, parseEntity } from '../../../shared/domain/parse-entity.ts'

export type UsageEventMetadata = v.InferOutput<typeof MetadataSchema>

/** Producers' clocks drift; allow a small window into the future. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000

/**
 * Immutable fact: a customer consumed `quantity` units of `eventName` at `occurredAt`.
 * `eventId` is producer-owned: dedup key here and `external_id` when forwarded to Polar.
 */
export function usageEventSchema(now: Date) {
  return v.object({
    customerId: v.pipe(v.string(), v.uuid()),
    eventName: v.pipe(v.string(), v.trim(), v.nonEmpty('eventName is required'), v.maxLength(100)),
    eventId: v.pipe(v.string(), v.trim(), v.nonEmpty('eventId is required'), v.maxLength(200)),
    quantity: v.optional(v.pipe(v.number(), v.finite(), v.gtValue(0, 'quantity must be a positive number')), 1),
    occurredAt: v.optional(
      v.pipe(
        v.date(),
        v.maxValue(new Date(now.getTime() + FUTURE_TOLERANCE_MS), 'occurredAt cannot be in the future'),
      ),
      now,
    ),
    metadata: v.optional(MetadataSchema, {}),
  })
}

export type UsageEvent = v.InferOutput<ReturnType<typeof usageEventSchema>>
export type UsageEventInput = v.InferInput<ReturnType<typeof usageEventSchema>>

export function newUsageEvent(input: UsageEventInput, now = new Date()) {
  return parseEntity(usageEventSchema(now), input)
}

/** A persisted event: row identity needed to mark it synced (hypertable PK is (occurredAt, id)). */
export type StoredUsageEvent = UsageEvent & { id: string; polarSyncedAt: Date | null }

export const usageBuckets = ['hour', 'day', 'week', 'month'] as const
export type UsageBucket = (typeof usageBuckets)[number]

export type Period = { start: Date; end: Date }

/** Current UTC calendar month: [first day 00:00Z, first day of next month 00:00Z). */
export function currentMonthPeriod(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  const period: Period = { start, end }
  return period
}
