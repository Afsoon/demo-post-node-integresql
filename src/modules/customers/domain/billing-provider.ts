import type { CustomerMetadata, CustomerType } from './customer.ts'

export type BillingProviderCustomerInput = {
  /** Our customer id — stored on the provider side as the stable external id. */
  externalId: string
  email: string
  name: string
  type: CustomerType
  metadata: CustomerMetadata
}

export type BillingProviderCustomerPatch = Partial<Pick<BillingProviderCustomerInput, 'email' | 'name' | 'metadata'>>

/** Port: customer mirror in the billing provider (Polar). */
export interface BillingProviderCustomers {
  create(input: BillingProviderCustomerInput): Promise<{ providerCustomerId: string }>
  update(providerCustomerId: string, patch: BillingProviderCustomerPatch): Promise<void>
  delete(providerCustomerId: string): Promise<void>
}
