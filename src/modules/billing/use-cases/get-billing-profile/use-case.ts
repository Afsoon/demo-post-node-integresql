import { NotFoundError } from '../../../../shared/errors.ts'
import type { BillingProfileRepository } from '../../domain/billing-profile-repository.ts'

type Deps = { billingProfiles: BillingProfileRepository }

export function createGetBillingProfile({ billingProfiles }: Deps) {
  return async (customerId: string) => {
    const profile = await billingProfiles.findByCustomerId(customerId)
    if (!profile) throw new NotFoundError('billing profile for customer', customerId)
    return profile
  }
}
