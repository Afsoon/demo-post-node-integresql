import { ConflictError } from '../../../../shared/errors.ts'
import type { BillingProviderCustomers } from '../../domain/billing-provider.ts'
import { linkBillingProvider, newCustomer } from '../../domain/customer.ts'
import type { CustomerRepository } from '../../domain/customer-repository.ts'
import type { CreateCustomerInput } from './schema.ts'

type Deps = { customers: CustomerRepository; billingProvider: BillingProviderCustomers }

export function createCreateCustomer({ customers, billingProvider }: Deps) {
  return async (input: CreateCustomerInput) => {
    const candidate = newCustomer(input)
    const existing = await customers.findByEmail(candidate.email)
    if (existing) throw new ConflictError(`customer with email ${candidate.email} already exists`, { email: candidate.email })

    // Persist first so the provider receives our stable id as external_id.
    const stored = await customers.insert(candidate)
    const { providerCustomerId } = await billingProvider.create({
      externalId: stored.id,
      email: stored.email,
      name: stored.name,
      type: stored.type,
      metadata: stored.metadata,
    })
    return customers.save(linkBillingProvider(stored, providerCustomerId))
  }
}
