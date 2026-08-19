import * as v from 'valibot'
import { UuidSchema } from '../../../../shared/http/schemas.ts'
import { PeriodSchema, UsageSummarySchema } from '../../schemas.ts'

export const UsageLimitStatusSchema = v.object({
  monthlyEventLimit: v.pipe(v.number(), v.integer()),
  remaining: v.pipe(v.number(), v.integer()),
  hardLimit: v.boolean(),
  exceeded: v.boolean(),
})

export const CurrentUsageSchema = v.object({
  customerId: UuidSchema,
  period: PeriodSchema,
  ...UsageSummarySchema.entries,
  limit: v.nullable(UsageLimitStatusSchema),
})

export type CurrentUsage = v.InferOutput<typeof CurrentUsageSchema>
