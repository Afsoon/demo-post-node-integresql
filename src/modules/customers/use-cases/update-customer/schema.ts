import * as v from 'valibot'
import { MetadataSchema } from '../../../../shared/http/schemas.ts'
import { CustomerStatusSchema } from '../../schemas.ts'

export const UpdateCustomerBodySchema = v.pipe(
  v.object({
    email: v.optional(v.pipe(v.string(), v.email())),
    name: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(200))),
    status: v.optional(CustomerStatusSchema),
    metadata: v.optional(MetadataSchema),
  }),
  v.check((body) => Object.keys(body).length > 0, 'at least one field must be provided'),
)

export type UpdateCustomerInput = v.InferOutput<typeof UpdateCustomerBodySchema>
