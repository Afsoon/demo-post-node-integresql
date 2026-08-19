import * as v from 'valibot'
import { IsoDateTimeSchema, MetadataSchema, UuidSchema } from '../../../../shared/http/schemas.ts'

export const UsageEventInputSchema = v.object({
  customerId: UuidSchema,
  eventName: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
  eventId: v.pipe(
    v.string(),
    v.minLength(1),
    v.maxLength(200),
    v.description('Producer-owned event id: global dedup key, forwarded to Polar as external_id'),
  ),
  quantity: v.optional(v.pipe(v.number(), v.minValue(0, 'quantity must be positive')), 1),
  occurredAt: v.optional(v.pipe(IsoDateTimeSchema, v.description('Defaults to server time'))),
  metadata: v.optional(MetadataSchema),
})

export const IngestUsageEventsBodySchema = v.pipe(
  v.array(UsageEventInputSchema),
  v.minLength(1),
  v.maxLength(1000),
  v.description('1..1000 usage events'),
)

export type IngestUsageEventsInput = v.InferOutput<typeof IngestUsageEventsBodySchema>

export const RejectedUsageEventSchema = v.object({
  index: v.pipe(v.number(), v.integer(), v.description('Position in the submitted array')),
  eventId: v.string(),
  reason: v.picklist(['invalid', 'unknown_customer']),
  message: v.string(),
})

export const IngestUsageEventsResultSchema = v.object({
  received: v.pipe(v.number(), v.integer()),
  inserted: v.pipe(v.number(), v.integer()),
  duplicates: v.pipe(v.number(), v.integer(), v.description('Events whose eventId was already stored (or repeated in the batch)')),
  rejected: v.array(RejectedUsageEventSchema),
})

export type IngestUsageEventsResult = v.InferOutput<typeof IngestUsageEventsResultSchema>
