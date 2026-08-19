import type { Customer, NewCustomer } from './customer.ts'

export type CustomerPage = { items: Customer[]; nextCursor: string | null }

export interface CustomerRepository {
  findById(id: string): Promise<Customer | null>
  findByIds(ids: string[]): Promise<Customer[]>
  findByEmail(email: string): Promise<Customer | null>
  list(params: { limit: number; cursor?: string }): Promise<CustomerPage>
  insert(customer: NewCustomer): Promise<Customer>
  /** Persists the full aggregate state; returns the stored row. */
  save(customer: Customer): Promise<Customer>
  delete(id: string): Promise<boolean>
}
