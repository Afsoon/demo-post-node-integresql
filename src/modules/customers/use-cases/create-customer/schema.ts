import * as v from 'valibot'
import { MetadataSchema } from '../../../../shared/http/schemas.ts'
import { CustomerTypeSchema } from '../../schemas.ts'

export const CreateCustomerBodySchema = v.object({
  email: v.pipe(v.string(), v.email()),
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  type: CustomerTypeSchema,
  metadata: v.optional(MetadataSchema),
})

export type CreateCustomerInput = v.InferOutput<typeof CreateCustomerBodySchema>
