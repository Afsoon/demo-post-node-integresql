import type { BillingProfile, NewBillingProfile } from './billing-profile.ts'

export interface BillingProfileRepository {
  findByCustomerId(customerId: string): Promise<BillingProfile | null>
  insert(profile: NewBillingProfile): Promise<BillingProfile>
  save(profile: BillingProfile): Promise<BillingProfile>
  delete(customerId: string): Promise<boolean>
}
