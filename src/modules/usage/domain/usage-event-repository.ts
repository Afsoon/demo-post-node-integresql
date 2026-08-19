import type { Period, StoredUsageEvent, UsageBucket, UsageEvent } from './usage-event.ts'

export type InsertResult = { inserted: number; duplicates: number }

export type UsageByEventName = { eventName: string; quantity: number; count: number }

export type UsageSummary = { totalQuantity: number; eventCount: number; byEventName: UsageByEventName[] }

export type UsageBucketRow = { bucketStart: Date; quantity: number; count: number }

export interface UsageEventRepository {
  /** Idempotent on eventId (any customer / time); duplicates are skipped and counted. */
  insertMany(events: UsageEvent[]): Promise<InsertResult>
  /** Aggregates over [period.start, period.end). */
  summarize(customerId: string, period: Period): Promise<UsageSummary>
  /** time_bucket series over [period.start, period.end); empty buckets are omitted. */
  series(customerId: string, period: Period, bucket: UsageBucket): Promise<UsageBucketRow[]>
  /** Oldest-first events of the period not yet forwarded to the billing provider. */
  findUnsynced(customerId: string, period: Period, limit: number): Promise<StoredUsageEvent[]>
  markSynced(events: Pick<StoredUsageEvent, 'id' | 'occurredAt'>[], syncedAt: Date): Promise<void>
}
