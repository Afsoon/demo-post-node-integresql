import * as v from 'valibot'
import { UuidSchema } from '../../../../shared/http/schemas.ts'
import { CustomerSchema } from '../../schemas.ts'

export const ListCustomersQuerySchema = v.object({
  limit: v.optional(v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(100)), '20'),
  cursor: v.optional(UuidSchema),
})

export type ListCustomersInput = v.InferOutput<typeof ListCustomersQuerySchema>

export const CustomerPageSchema = v.object({
  items: v.array(CustomerSchema),
  nextCursor: v.nullable(UuidSchema),
})
