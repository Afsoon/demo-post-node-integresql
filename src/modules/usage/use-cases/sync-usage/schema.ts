import * as v from 'valibot'
import { IsoDateTimeSchema } from '../../../../shared/http/schemas.ts'

const MAX_RANGE_DAYS = 366

export const SyncUsageBodySchema = v.pipe(
  v.object({
    start: v.pipe(IsoDateTimeSchema, v.description('Inclusive, ISO 8601')),
    end: v.pipe(IsoDateTimeSchema, v.description('Exclusive, ISO 8601')),
  }),
  v.check((b) => new Date(b.end) > new Date(b.start), 'end must be after start'),
  v.check(
    (b) => new Date(b.end).getTime() - new Date(b.start).getTime() <= MAX_RANGE_DAYS * 86_400_000,
    `range cannot exceed ${MAX_RANGE_DAYS} days`,
  ),
)

export type SyncUsageInput = v.InferOutput<typeof SyncUsageBodySchema>
