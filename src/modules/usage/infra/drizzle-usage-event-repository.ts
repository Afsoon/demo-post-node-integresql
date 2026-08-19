import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import type { Db } from '../../../infra/db/client.ts'
import { usageEvents } from '../../../infra/db/schema/index.ts'
import type { StoredUsageEvent, UsageBucket, UsageEvent } from '../domain/usage-event.ts'
import type { UsageEventRepository } from '../domain/usage-event-repository.ts'

const INSERT_CHUNK = 500

/** Allow-list: the bucket name is never interpolated, only these literals reach SQL. */
const bucketInterval = {
  hour: sql`INTERVAL '1 hour'`,
  day: sql`INTERVAL '1 day'`,
  week: sql`INTERVAL '1 week'`,
  month: sql`INTERVAL '1 month'`,
} satisfies Record<UsageBucket, unknown>

type Row = typeof usageEvents.$inferSelect

function toRow(event: UsageEvent) {
  return {
    customerId: event.customerId,
    eventName: event.eventName,
    quantity: event.quantity.toString(),
    occurredAt: event.occurredAt,
    eventId: event.eventId,
    metadata: event.metadata,
  }
}

function toStored(row: Row) {
  const event: StoredUsageEvent = {
    id: row.id,
    customerId: row.customerId,
    eventName: row.eventName,
    quantity: Number(row.quantity),
    occurredAt: row.occurredAt,
    eventId: row.eventId,
    metadata: row.metadata,
    polarSyncedAt: row.polarSyncedAt,
  }
  return event
}

const quantitySum = sql<string>`coalesce(sum(${usageEvents.quantity}), 0)`
const rowCount = sql<number>`count(*)::int`

const inPeriod = (customerId: string, period: { start: Date; end: Date }) =>
  and(
    eq(usageEvents.customerId, customerId),
    gte(usageEvents.occurredAt, period.start),
    lt(usageEvents.occurredAt, period.end),
  )

export function createDrizzleUsageEventRepository(db: Db) {
  const repository: UsageEventRepository = {
    async insertMany(events) {
      // 1. in-batch dedup by eventId (first occurrence wins)
      const unique = new Map<string, UsageEvent>()
      for (const event of events) if (!unique.has(event.eventId)) unique.set(event.eventId, event)

      let inserted = 0
      const candidates = [...unique.values()]
      for (let i = 0; i < candidates.length; i += INSERT_CHUNK) {
        const chunk = candidates.slice(i, i + INSERT_CHUNK)
        // Sorted so two overlapping batches always lock in the same order (no deadlocks)
        const eventIds = chunk.map((e) => e.eventId).sort()
        inserted += await db.transaction(async (tx) => {
          // 2. serialize concurrent writers per eventId: the unique index includes the partition
          //    column (hypertable rule), so the same eventId at two timestamps would not conflict.
          const idList = sql.join(
            eventIds.map((id) => sql`${id}`),
            sql`, `,
          )
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(event_id)) FROM unnest(ARRAY[${idList}]::text[]) AS t(event_id)`)
          // 3. drop ids already stored (any customer, any time) — eventId is the global dedup key
          const existing = await tx
            .select({ eventId: usageEvents.eventId })
            .from(usageEvents)
            .where(inArray(usageEvents.eventId, eventIds))
          const known = new Set(existing.map((r) => r.eventId))
          const fresh = chunk.filter((e) => !known.has(e.eventId))
          if (fresh.length === 0) return 0
          // 4. insert; the unique (event_id, occurred_at) index still guards identical rows
          const rows = await tx
            .insert(usageEvents)
            .values(fresh.map(toRow))
            .onConflictDoNothing({ target: [usageEvents.eventId, usageEvents.occurredAt] })
            .returning({ id: usageEvents.id })
          return rows.length
        })
      }
      return { inserted, duplicates: events.length - inserted }
    },

    async summarize(customerId, period) {
      const rows = await db
        .select({ eventName: usageEvents.eventName, quantity: quantitySum, count: rowCount })
        .from(usageEvents)
        .where(inPeriod(customerId, period))
        .groupBy(usageEvents.eventName)
        .orderBy(desc(quantitySum))
      const byEventName = rows.map((r) => ({ eventName: r.eventName, quantity: Number(r.quantity), count: r.count }))
      return {
        totalQuantity: byEventName.reduce((acc, r) => acc + r.quantity, 0),
        eventCount: byEventName.reduce((acc, r) => acc + r.count, 0),
        byEventName,
      }
    },

    async series(customerId, period, bucket) {
      const bucketStart = sql<Date>`time_bucket(${bucketInterval[bucket]}, ${usageEvents.occurredAt})`
      const rows = await db
        .select({ bucketStart, quantity: quantitySum, count: rowCount })
        .from(usageEvents)
        .where(inPeriod(customerId, period))
        .groupBy(bucketStart)
        .orderBy(bucketStart)
      return rows.map((r) => ({ bucketStart: new Date(r.bucketStart), quantity: Number(r.quantity), count: r.count }))
    },

    async findUnsynced(customerId, period, limit) {
      const rows = await db
        .select()
        .from(usageEvents)
        .where(and(inPeriod(customerId, period), isNull(usageEvents.polarSyncedAt)))
        .orderBy(asc(usageEvents.occurredAt), asc(usageEvents.id))
        .limit(limit)
      return rows.map(toStored)
    },

    async markSynced(events, syncedAt) {
      if (events.length === 0) return
      // PK is (occurred_at, id): match on both so the planner prunes chunks
      await db
        .update(usageEvents)
        .set({ polarSyncedAt: syncedAt })
        .where(or(...events.map((e) => and(eq(usageEvents.occurredAt, e.occurredAt), eq(usageEvents.id, e.id)))))
    },
  }
  return repository
}
