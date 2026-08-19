import * as v from 'valibot'
import { IsoDateTimeSchema, UuidSchema } from '../../../../shared/http/schemas.ts'
import { PeriodSchema, UsageBucketRowSchema, UsageBucketSchema, UsageSummarySchema } from '../../schemas.ts'

const MAX_RANGE_DAYS = 366

export const UsageReportQuerySchema = v.pipe(
  v.object({
    start: v.pipe(IsoDateTimeSchema, v.description('Inclusive, ISO 8601')),
    end: v.pipe(IsoDateTimeSchema, v.description('Exclusive, ISO 8601')),
    bucket: v.optional(UsageBucketSchema, 'day'),
  }),
  v.check((q) => new Date(q.end) > new Date(q.start), 'end must be after start'),
  v.check(
    (q) => new Date(q.end).getTime() - new Date(q.start).getTime() <= MAX_RANGE_DAYS * 86_400_000,
    `range cannot exceed ${MAX_RANGE_DAYS} days`,
  ),
)

export type UsageReportInput = v.InferOutput<typeof UsageReportQuerySchema>

export const UsageReportSchema = v.object({
  customerId: UuidSchema,
  period: PeriodSchema,
  bucket: UsageBucketSchema,
  totals: UsageSummarySchema,
  series: v.array(UsageBucketRowSchema),
})

export type UsageReport = v.InferOutput<typeof UsageReportSchema>
