import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { HttpResponse, http } from 'msw'
import {
  type BillingProfileBody,
  type CustomerBody,
  type SyncPeriodBody,
  type UsageEventBody,
  billingProfileBody,
  customerBody,
  idempotencyKey,
} from '../factories/index.ts'
import type { TestApi } from './api.ts'

/**
 * "GIVEN …" helpers: preconditions created through the API. They never assert — an unexpected
 * status throws, so a broken precondition fails loudly instead of producing a misleading result.
 * The few `sql*` helpers cover states the API cannot produce (idempotency row lifecycle).
 */

export const UNKNOWN_ID = '00000000-0000-7000-8000-000000000000'

async function expectStatus<T extends Response>(response: T, status: number, what: string) {
  if (response.status !== status) {
    throw new Error(`fixture ${what}: expected ${status}, got ${response.status}: ${await response.text()}`)
  }
  return response
}

export async function givenCustomer(api: TestApi, overrides: Partial<CustomerBody> = {}) {
  const response = await api.client.customers.$post({ json: customerBody(overrides) })
  return (await expectStatus(response, 201, 'givenCustomer')).json()
}

/** Polar fails once → the row is stored without `polarCustomerId` (retryable by design). */
export async function givenUnlinkedCustomer(api: TestApi, overrides: Partial<CustomerBody> = {}) {
  api.polar.use(
    http.post(`${api.polar.baseUrl}/v1/customers/`, () => HttpResponse.json({ detail: 'down' }, { status: 500 }), {
      once: true,
    }),
  )
  const body = customerBody(overrides)
  await expectStatus(await api.client.customers.$post({ json: body }), 502, 'givenUnlinkedCustomer')
  const list = await (await api.client.customers.$get({ query: { limit: '100' } })).json()
  const customer = list.items.find((c) => c.email === body.email.toLowerCase() && c.polarCustomerId === null)
  if (!customer) throw new Error('fixture givenUnlinkedCustomer: no unlinked customer found')
  return customer
}

export async function givenBillingProfile(api: TestApi, customerId: string, body: BillingProfileBody = billingProfileBody()) {
  const response = await api.client.customers[':customerId']['billing-profile'].$post({ param: { customerId }, json: body })
  return (await expectStatus(response, 201, 'givenBillingProfile')).json()
}

/** A customer mirrored in Polar with a pro billing profile (7 cents/unit, limit 10). */
export async function givenBillableCustomer(api: TestApi, profile: BillingProfileBody = billingProfileBody()) {
  const customer = await givenCustomer(api)
  await givenBillingProfile(api, customer.id, profile)
  return customer
}

export async function givenIngestedEvents(api: TestApi, events: UsageEventBody[], key: string = idempotencyKey()) {
  const response = await api.client.webhooks['usage-events'].$post({ json: events }, { headers: { 'x-idempotency-id': key } })
  return (await expectStatus(response, 200, 'givenIngestedEvents')).json()
}

/** Marks every event of the period as synced (and charges it), so the next sync has nothing to do. */
export async function givenSyncedUsage(api: TestApi, customerId: string, period: SyncPeriodBody) {
  const response = await api.client.customers[':customerId'].usage.sync.$post({ param: { customerId }, json: period })
  return (await expectStatus(response, 200, 'givenSyncedUsage')).json()
}

/** `METHOD /path` of every call Polar received, in order. */
export const polarCalls = (api: TestApi) => api.polar.requests.map((r) => `${r.method} ${r.url}`)

// ---- raw SQL: idempotency row states unreachable through the API ----

/** Same hash the middleware computes: sha256 of the exact bytes the client sends (JSON.stringify). */
const bodyHash = (body: unknown) => createHash('sha256').update(JSON.stringify(body)).digest('hex')

/** A request with this key+body is "still being processed" (e.g. a crashed worker). */
export async function sqlMarkIdempotencyKeyProcessing(api: TestApi, key: string, body: unknown) {
  await api.db.execute(sql`
    INSERT INTO webhook_idempotency_keys (key, request_hash, status, expires_at)
    VALUES (${key}, ${bodyHash(body)}, 'processing', now() + interval '72 hours')
  `)
}

/** Time travel: the stored response for this key is older than the 72h window. */
export async function sqlExpireIdempotencyKey(api: TestApi, key: string) {
  await api.db.execute(sql`UPDATE webhook_idempotency_keys SET expires_at = now() - interval '1 hour' WHERE key = ${key}`)
}

export async function sqlIdempotencyKeyTtlHours(api: TestApi, key: string) {
  const result = await api.db.execute<{ hours: string }>(sql`
    SELECT extract(epoch FROM (expires_at - created_at)) / 3600 AS hours
    FROM webhook_idempotency_keys WHERE key = ${key}
  `)
  return Number(result.rows[0]?.hours)
}

/** Simulates a crash between the Polar ingest and `markSynced`: events look unsynced again. */
export async function sqlUnmarkSynced(api: TestApi, customerId: string) {
  await api.db.execute(sql`UPDATE usage_events SET polar_synced_at = NULL WHERE customer_id = ${customerId}`)
}

// ---- read-only DB peeks for facts the API does not expose ----

export async function sqlCountUsageEvents(api: TestApi, customerId: string) {
  const result = await api.db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM usage_events WHERE customer_id = ${customerId}`)
  return Number(result.rows[0]?.n)
}

export async function sqlCountSettlements(api: TestApi, customerId: string) {
  const result = await api.db.execute<{ n: string }>(
    sql`SELECT count(*)::text AS n FROM usage_settlements WHERE customer_id = ${customerId}`,
  )
  return Number(result.rows[0]?.n)
}

// ---- fan-out helpers for the stress suite ----

export async function givenCustomers(api: TestApi, count: number) {
  return Promise.all(Array.from({ length: count }, () => givenCustomer(api)))
}

export async function givenBillableCustomers(api: TestApi, count: number, profile: BillingProfileBody = billingProfileBody()) {
  return Promise.all(Array.from({ length: count }, () => givenBillableCustomer(api, profile)))
}

/** Counts responses by status: `{ 200: 3, 409: 7 }`. */
export const statusHistogram = (responses: Response[]) =>
  responses.reduce<Record<number, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {})
