import { NotFoundError } from '../../../../shared/errors.ts'
import type { BillingProviderCustomers } from '../../domain/billing-provider.ts'
import { applyCustomerPatch } from '../../domain/customer.ts'
import type { CustomerRepository } from '../../domain/customer-repository.ts'
import type { UpdateCustomerInput } from './schema.ts'

type Deps = { customers: CustomerRepository; billingProvider: BillingProviderCustomers }

export function createUpdateCustomer({ customers, billingProvider }: Deps) {
  return async (id: string, patch: UpdateCustomerInput) => {
    const current = await customers.findById(id)
    if (!current) throw new NotFoundError('customer', id)

    const updated = applyCustomerPatch(current, patch)
    const saved = await customers.save(updated)

    const providerFieldsChanged =
      saved.email !== current.email || saved.name !== current.name || patch.metadata !== undefined
    if (saved.polarCustomerId && providerFieldsChanged) {
      await billingProvider.update(saved.polarCustomerId, {
        email: saved.email,
        name: saved.name,
        metadata: saved.metadata,
      })
    }
    return saved
  }
}
