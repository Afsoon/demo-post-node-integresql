import type { CustomerRepository } from '../../domain/customer-repository.ts'
import type { ListCustomersInput } from './schema.ts'

type Deps = { customers: CustomerRepository }

export function createListCustomers({ customers }: Deps) {
  return (input: ListCustomersInput) => customers.list(input)
}
