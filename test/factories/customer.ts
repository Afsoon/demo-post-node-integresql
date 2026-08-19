import type { CustomerBody, CustomerPatch } from './types.ts'

let counter = 0

/** Unique email per call so several customers can coexist in one test. */
export function customerBody(overrides: Partial<CustomerBody> = {}) {
  counter += 1
  const body: CustomerBody = { email: `ada+${counter}@example.com`, name: 'Ada Lovelace', type: 'individual', ...overrides }
  return body
}

export function customerPatch(overrides: CustomerPatch = {}) {
  const body: CustomerPatch = { name: 'Ada L.', ...overrides }
  return body
}
