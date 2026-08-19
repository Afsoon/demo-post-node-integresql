import { NotFoundError } from '../../../../shared/errors.ts'
import type { BillingProfileRepository } from '../../domain/billing-profile-repository.ts'

type Deps = { billingProfiles: BillingProfileRepository }

export function createDeleteBillingProfile({ billingProfiles }: Deps) {
  return async (customerId: string) => {
    const deleted = await billingProfiles.delete(customerId)
    if (!deleted) throw new NotFoundError('billing profile for customer', customerId)
  }
}
