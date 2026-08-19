import * as v from 'valibot'
import { IsoDateTimeSchema, UuidSchema } from '../../shared/http/schemas.ts'
import { type Period, usageBuckets } from './domain/usage-event.ts'
import type { UsageSummary } from './domain/usage-event-repository.ts'
import type { UsageSettlement } from './domain/usage-settlement.ts'

export const UsageBucketSchema = v.picklist(usageBuckets)

export const PeriodSchema = v.object({ start: IsoDateTimeSchema, end: IsoDateTimeSchema })

export const UsageByEventNameSchema = v.object({
  eventName: v.string(),
  quantity: v.number(),
  count: v.pipe(v.number(), v.integer()),
})

export const UsageSummarySchema = v.object({
  totalQuantity: v.number(),
  eventCount: v.pipe(v.number(), v.integer()),
  byEventName: v.array(UsageByEventNameSchema),
})

export const UsageBucketRowSchema = v.object({
  bucketStart: IsoDateTimeSchema,
  quantity: v.number(),
  count: v.pipe(v.number(), v.integer()),
})

export const CustomerUsageParamSchema = v.object({ customerId: UuidSchema })

export function toPeriodResponse(period: Period) {
  return { start: period.start.toISOString(), end: period.end.toISOString() }
}

export function toSummaryResponse(summary: UsageSummary) {
  const response: v.InferOutput<typeof UsageSummarySchema> = summary
  return response
}

export const UsageChargeSchema = v.object({
  amountCents: v.pipe(v.number(), v.integer()),
  currency: v.string(),
  orderId: v.string(),
  status: v.string(),
})

export const UsageSettlementSchema = v.object({
  id: UuidSchema,
  customerId: UuidSchema,
  period: PeriodSchema,
  syncedEvents: v.pipe(v.number(), v.integer()),
  syncedQuantity: v.number(),
  charge: v.nullable(UsageChargeSchema),
  createdAt: IsoDateTimeSchema,
})

export function toSettlementResponse(settlement: UsageSettlement) {
  const response: v.InferOutput<typeof UsageSettlementSchema> = {
    ...settlement,
    period: toPeriodResponse(settlement.period),
    createdAt: settlement.createdAt.toISOString(),
  }
  return response
}
