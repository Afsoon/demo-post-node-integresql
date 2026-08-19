import { NotFoundError } from '../../../../shared/errors.ts'
import { applyBillingProfilePatch } from '../../domain/billing-profile.ts'
import type { BillingProfileRepository } from '../../domain/billing-profile-repository.ts'
import type { UpdateBillingProfileInput } from './schema.ts'

type Deps = { billingProfiles: BillingProfileRepository }

export function createUpdateBillingProfile({ billingProfiles }: Deps) {
  return async (customerId: string, patch: UpdateBillingProfileInput) => {
    const current = await billingProfiles.findByCustomerId(customerId)
    if (!current) throw new NotFoundError('billing profile for customer', customerId)
    return billingProfiles.save(applyBillingProfilePatch(current, patch))
  }
}
