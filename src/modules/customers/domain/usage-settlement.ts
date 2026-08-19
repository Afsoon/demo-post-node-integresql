/**
 * Port: settle (sync to the billing provider + charge) a customer's usage for a period.
 * Implemented by the usage module's sync use case; the customers module only knows the result shape.
 */
export type SettlementPeriod = { start: Date; end: Date }

export type SettlementResult = {
  id: string
  customerId: string
  period: SettlementPeriod
  syncedEvents: number
  syncedQuantity: number
  charge: { amountCents: number; currency: string; orderId: string; status: string } | null
  createdAt: Date
}

export type SettleUsage = (customerId: string, period: SettlementPeriod) => Promise<SettlementResult>

/** Current UTC calendar month: [first day 00:00Z, first day of next month 00:00Z). */
export function currentMonthPeriod(now = new Date()) {
  const period: SettlementPeriod = {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  }
  return period
}
