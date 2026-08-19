import { NotFoundError } from '../../../../shared/errors.ts'
import type { CustomerRepository } from '../../domain/customer-repository.ts'

type Deps = { customers: CustomerRepository }

export function createGetCustomer({ customers }: Deps) {
  return async (id: string) => {
    const customer = await customers.findById(id)
    if (!customer) throw new NotFoundError('customer', id)
    return customer
  }
}
