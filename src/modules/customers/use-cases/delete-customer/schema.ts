import * as v from 'valibot'
import { IsoDateTimeSchema, UuidSchema } from '../../../../shared/http/schemas.ts'
import type { SettlementResult } from '../../domain/usage-settlement.ts'

export const SettlementResultSchema = v.object({
  id: UuidSchema,
  customerId: UuidSchema,
  period: v.object({ start: IsoDateTimeSchema, end: IsoDateTimeSchema }),
  syncedEvents: v.pipe(v.number(), v.integer()),
  syncedQuantity: v.number(),
  charge: v.nullable(
    v.object({ amountCents: v.pipe(v.number(), v.integer()), currency: v.string(), orderId: v.string(), status: v.string() }),
  ),
  createdAt: IsoDateTimeSchema,
})

export const DeleteCustomerResultSchema = v.object({
  customerId: UuidSchema,
  settlement: v.pipe(
    v.nullable(SettlementResultSchema),
    v.description('Current-month usage synced and charged before deletion; null when the customer was not linked to Polar'),
  ),
})

export function toSettlementResultResponse(settlement: SettlementResult) {
  const response: v.InferOutput<typeof SettlementResultSchema> = {
    ...settlement,
    period: { start: settlement.period.start.toISOString(), end: settlement.period.end.toISOString() },
    createdAt: settlement.createdAt.toISOString(),
  }
  return response
}
