import type { Db } from '../../../infra/db/client.ts'
import { usageSettlements } from '../../../infra/db/schema/index.ts'
import type { UsageSettlement, UsageSettlementRepository } from '../domain/usage-settlement.ts'

type Row = typeof usageSettlements.$inferSelect

function toSettlement(row: Row) {
  const settlement: UsageSettlement = {
    id: row.id,
    customerId: row.customerId,
    period: { start: row.periodStart, end: row.periodEnd },
    syncedEvents: row.syncedEvents,
    syncedQuantity: Number(row.syncedQuantity),
    charge:
      row.polarOrderId && row.currency
        ? {
            amountCents: row.amountCents,
            currency: row.currency,
            orderId: row.polarOrderId,
            status: row.polarOrderStatus ?? 'unknown',
          }
        : null,
    createdAt: row.createdAt,
  }
  return settlement
}

export function createDrizzleUsageSettlementRepository(db: Db) {
  const repository: UsageSettlementRepository = {
    async insert(settlement) {
      const [row] = await db
        .insert(usageSettlements)
        .values({
          customerId: settlement.customerId,
          periodStart: settlement.period.start,
          periodEnd: settlement.period.end,
          syncedEvents: settlement.syncedEvents,
          syncedQuantity: settlement.syncedQuantity.toString(),
          amountCents: settlement.charge?.amountCents ?? 0,
          currency: settlement.charge?.currency ?? null,
          polarOrderId: settlement.charge?.orderId ?? null,
          polarOrderStatus: settlement.charge?.status ?? null,
        })
        .returning()
      return toSettlement(row!)
    },
  }
  return repository
}
