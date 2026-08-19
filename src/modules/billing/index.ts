import type { Db } from '../../infra/db/client.ts'
import type { CustomerRepository } from '../customers/domain/customer-repository.ts'
import { createDrizzleBillingProfileRepository } from './infra/drizzle-billing-profile-repository.ts'
import { createCreateBillingProfile } from './use-cases/create-billing-profile/use-case.ts'
import { createDeleteBillingProfile } from './use-cases/delete-billing-profile/use-case.ts'
import { createGetBillingProfile } from './use-cases/get-billing-profile/use-case.ts'
import { createUpdateBillingProfile } from './use-cases/update-billing-profile/use-case.ts'

export type BillingModuleDeps = { db: Db; customers: Pick<CustomerRepository, 'findById'> }

/** Wires the billing module: repository + use cases. */
export function createBillingModule({ db, customers }: BillingModuleDeps) {
  const billingProfiles = createDrizzleBillingProfileRepository(db)
  return {
    repository: billingProfiles,
    create: createCreateBillingProfile({ billingProfiles, customers }),
    get: createGetBillingProfile({ billingProfiles }),
    update: createUpdateBillingProfile({ billingProfiles }),
    delete: createDeleteBillingProfile({ billingProfiles }),
  }
}

export type BillingModule = ReturnType<typeof createBillingModule>
