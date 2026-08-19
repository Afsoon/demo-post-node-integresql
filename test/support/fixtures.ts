import type { TestApi } from './api.ts'

/**
 * Arrange helpers ("GIVEN …"). They never assert: an unexpected status throws,
 * so a broken precondition fails loudly instead of producing a misleading test result.
 */

type Client = TestApi['client']
type CustomerBody = Parameters<Client['customers']['$post']>[0]['json']
type BillingProfileBody = Parameters<Client['customers'][':customerId']['billing-profile']['$post']>[0]['json']
type UsageEventBody = Parameters<Client['webhooks']['usage-events']['$post']>[0]['json'][number]

async function expectStatus<T extends Response>(response: T, status: number, what: string) {
  if (response.status !== status) {
    throw new Error(`fixture ${what}: expected ${status}, got ${response.status}: ${await response.text()}`)
  }
  return response
}

export const defaultCustomer: CustomerBody = { email: 'ada@example.com', name: 'Ada Lovelace', type: 'individual' }

export async function givenCustomer(api: TestApi, overrides: Partial<CustomerBody> = {}) {
  const response = await api.client.customers.$post({ json: { ...defaultCustomer, ...overrides } })
  return (await expectStatus(response, 201, 'givenCustomer')).json()
}

export const defaultBillingProfile: BillingProfileBody = {
  company: {
    legalName: 'Ada Ltd',
    billingEmail: 'billing@ada.io',
    address: { line1: '1 Main St', city: 'London', postalCode: 'E1', country: 'gb' },
  },
  limits: { monthlyEventLimit: 10, rateLimitPerMinute: 60 },
  pricing: { plan: 'pro', currency: 'eur', pricePerUnitCents: 7 },
}

export async function givenBillingProfile(api: TestApi, customerId: string, overrides: Partial<BillingProfileBody> = {}) {
  const response = await api.client.customers[':customerId']['billing-profile'].$post({
    param: { customerId },
    json: { ...defaultBillingProfile, ...overrides },
  })
  return (await expectStatus(response, 201, 'givenBillingProfile')).json()
}

/** A customer mirrored in Polar with a pro billing profile: the common starting point for usage specs. */
export async function givenBillableCustomer(api: TestApi) {
  const customer = await givenCustomer(api)
  await givenBillingProfile(api, customer.id)
  return customer
}

let eventCounter = 0

/** Usage event payload builder with a unique eventId per call. */
export function event(customerId: string, overrides: Partial<UsageEventBody> = {}) {
  eventCounter += 1
  const body: UsageEventBody = { customerId, eventName: 'api_call', eventId: `evt-${eventCounter}`, ...overrides }
  return body
}

export async function givenIngestedEvents(api: TestApi, events: UsageEventBody[], idempotencyKey: string = crypto.randomUUID()) {
  const response = await api.client.webhooks['usage-events'].$post(
    { json: events },
    { headers: { 'x-idempotency-id': idempotencyKey } },
  )
  return (await expectStatus(response, 200, 'givenIngestedEvents')).json()
}

/** Marks every event of the period as synced (and charges it), so the next sync has nothing to do. */
export async function givenSyncedUsage(api: TestApi, customerId: string, period: { start: string; end: string }) {
  const response = await api.client.customers[':customerId'].usage.sync.$post({ param: { customerId }, json: period })
  return (await expectStatus(response, 200, 'givenSyncedUsage')).json()
}

/** Wide period covering every event ingested "now" during a test run. */
export const thisYear = { start: '2026-01-01T00:00:00Z', end: '2026-12-31T00:00:00Z' }

/** `METHOD /path` of every call Polar received, in order. */
export const polarCalls = (api: TestApi) => api.polar.requests.map((r) => `${r.method} ${r.url}`)
