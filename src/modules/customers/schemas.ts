import * as v from 'valibot'
import { IsoDateTimeSchema, MetadataSchema, UuidSchema } from '../../shared/http/schemas.ts'
import { type Customer, customerStatuses, customerTypes } from './domain/customer.ts'

export const CustomerTypeSchema = v.picklist(customerTypes)
export const CustomerStatusSchema = v.picklist(customerStatuses)

export const CustomerSchema = v.object({
  id: UuidSchema,
  email: v.pipe(v.string(), v.email()),
  name: v.string(),
  type: CustomerTypeSchema,
  status: CustomerStatusSchema,
  polarCustomerId: v.nullable(v.string()),
  metadata: MetadataSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
})

export function toCustomerResponse(customer: Customer) {
  const response: v.InferOutput<typeof CustomerSchema> = {
    ...customer,
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  }
  return response
}
