import { NotFoundError } from '../../../../shared/errors.ts'
import type { CustomerRepository } from '../../../customers/domain/customer-repository.ts'
import { newBillingProfile } from '../../domain/billing-profile.ts'
import type { BillingProfileRepository } from '../../domain/billing-profile-repository.ts'
import type { CreateBillingProfileInput } from './schema.ts'

type Deps = { billingProfiles: BillingProfileRepository; customers: Pick<CustomerRepository, 'findById'> }

export function createCreateBillingProfile({ billingProfiles, customers }: Deps) {
  return async (customerId: string, input: CreateBillingProfileInput) => {
    const customer = await customers.findById(customerId)
    if (!customer) throw new NotFoundError('customer', customerId)
    return billingProfiles.insert(newBillingProfile({ customerId, ...input }))
  }
}
