import type { Db } from '../../infra/db/client.ts'
import type { BillingProviderCustomers } from './domain/billing-provider.ts'
import type { SettleUsage } from './domain/usage-settlement.ts'
import { createDrizzleCustomerRepository } from './infra/drizzle-customer-repository.ts'
import { createCreateCustomer } from './use-cases/create-customer/use-case.ts'
import { createDeleteCustomer } from './use-cases/delete-customer/use-case.ts'
import { createGetCustomer } from './use-cases/get-customer/use-case.ts'
import { createListCustomers } from './use-cases/list-customers/use-case.ts'
import { createUpdateCustomer } from './use-cases/update-customer/use-case.ts'

export type CustomersModuleDeps = { db: Db; billingProvider: BillingProviderCustomers; settleUsage: SettleUsage }

/** Wires the customers module: repository + use cases. */
export function createCustomersModule({ db, billingProvider, settleUsage }: CustomersModuleDeps) {
  const customers = createDrizzleCustomerRepository(db)
  return {
    repository: customers,
    create: createCreateCustomer({ customers, billingProvider }),
    get: createGetCustomer({ customers }),
    list: createListCustomers({ customers }),
    update: createUpdateCustomer({ customers, billingProvider }),
    delete: createDeleteCustomer({ customers, billingProvider, settleUsage }),
  }
}

export type CustomersModule = ReturnType<typeof createCustomersModule>
