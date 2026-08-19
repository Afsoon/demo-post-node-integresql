import * as v from 'valibot'
import { MetadataSchema, parseEntity } from '../../../shared/domain/parse-entity.ts'

export const customerTypes = ['individual', 'team'] as const
export const customerStatuses = ['active', 'suspended'] as const

export type CustomerType = (typeof customerTypes)[number]
export type CustomerStatus = (typeof customerStatuses)[number]
export type CustomerMetadata = v.InferOutput<typeof MetadataSchema>

const EmailSchema = v.pipe(v.string(), v.trim(), v.toLowerCase(), v.nonEmpty('email is required'), v.email())
const NameSchema = v.pipe(v.string(), v.trim(), v.nonEmpty('name is required'), v.maxLength(200))

/** Aggregate invariants. Also normalizes (trim, lowercase email). */
export const CustomerSchema = v.object({
  id: v.pipe(v.string(), v.uuid()),
  email: EmailSchema,
  name: NameSchema,
  type: v.picklist(customerTypes),
  status: v.picklist(customerStatuses),
  polarCustomerId: v.nullable(v.string()),
  metadata: MetadataSchema,
  createdAt: v.date(),
  updatedAt: v.date(),
})

export type Customer = v.InferOutput<typeof CustomerSchema>

/** Aggregate state before persistence assigns id/timestamps. */
export const NewCustomerSchema = v.object({
  email: EmailSchema,
  name: NameSchema,
  type: v.picklist(customerTypes),
  status: v.optional(v.picklist(customerStatuses), 'active'),
  metadata: v.optional(MetadataSchema, {}),
})

export type NewCustomer = v.InferOutput<typeof NewCustomerSchema>

export type CustomerPatch = Partial<Pick<Customer, 'email' | 'name' | 'status' | 'metadata'>>

export function newCustomer(input: v.InferInput<typeof NewCustomerSchema>) {
  return parseEntity(NewCustomerSchema, input)
}

export function applyCustomerPatch(customer: Customer, patch: CustomerPatch) {
  return parseEntity(CustomerSchema, { ...customer, ...patch, updatedAt: new Date() })
}

export function linkBillingProvider(customer: Customer, polarCustomerId: string) {
  return parseEntity(CustomerSchema, { ...customer, polarCustomerId, updatedAt: new Date() })
}
