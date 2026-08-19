import type { Period } from './usage-event.ts'

export type UsageCharge = { amountCents: number; currency: string; orderId: string; status: string }

export type UsageSettlement = {
  id: string
  customerId: string
  period: Period
  syncedEvents: number
  syncedQuantity: number
  charge: UsageCharge | null
  createdAt: Date
}

export type NewUsageSettlement = Omit<UsageSettlement, 'id' | 'createdAt'>

export interface UsageSettlementRepository {
  insert(settlement: NewUsageSettlement): Promise<UsageSettlement>
}
