import { describe, expect, it } from 'vitest'
import { type UsageEventBody, idempotencyKey, isoMinutesFromNow, usageBatch, usageEventBody } from '../factories/index.ts'
import { TestApi } from '../support/api.ts'
import {
  UNKNOWN_ID,
  givenBillableCustomer,
  givenCustomer,
  givenIngestedEvents,
  sqlExpireIdempotencyKey,
  sqlIdempotencyKeyTtlHours,
  sqlMarkIdempotencyKeyProcessing,
} from '../support/fixtures.ts'

const ingest = (api: TestApi, events: UsageEventBody[], key = idempotencyKey()) =>
  api.client.webhooks['usage-events'].$post({ json: events }, { headers: { 'x-idempotency-id': key } })

describe('usage events webhook', () => {
  describe('GIVEN a billable customer', () => {
    it('WHEN ingesting a batch with an in-batch duplicate and an unknown customer THEN the outcome reports inserted, duplicates and rejected', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      const batch = [
        usageEventBody(customer.id, { eventId: 'e-1', quantity: 2 }),
        usageEventBody(customer.id, { eventId: 'e-1', quantity: 99 }),
        usageEventBody(customer.id, { eventId: 'e-2', eventName: 'tokens', quantity: 10.5 }),
        usageEventBody(UNKNOWN_ID, { eventId: 'e-3' }),
      ]

      const response = await ingest(api, batch)

      expect(await response.json()).toEqual({
        received: 4,
        inserted: 2,
        duplicates: 1,
        rejected: [{ index: 3, eventId: 'e-3', reason: 'unknown_customer', message: expect.any(String) }],
      })
    })

    it('WHEN an event breaks a domain rule THEN it is rejected as invalid and the rest is stored', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)

      const response = await ingest(api, [
        usageEventBody(customer.id, { eventId: 'ok' }),
        usageEventBody(customer.id, { eventId: 'zero', quantity: 0 }),
        usageEventBody(customer.id, { eventId: 'future', occurredAt: '2031-01-01T00:00:00Z' }),
      ])

      expect(await response.json()).toMatchObject({
        inserted: 1,
        rejected: [
          { index: 1, eventId: 'zero', reason: 'invalid' },
          { index: 2, eventId: 'future', reason: 'invalid', message: expect.stringContaining('future') },
        ],
      })
    })

    it('WHEN an eventId was already stored for another customer THEN it counts as a duplicate', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      const other = await givenCustomer(api)
      await givenIngestedEvents(api, [usageEventBody(other.id, { eventId: 'shared' })])

      const response = await ingest(api, [usageEventBody(customer.id, { eventId: 'shared' })])

      expect(await response.json()).toMatchObject({ inserted: 0, duplicates: 1 })
    })

    it('WHEN ingesting an empty array THEN 400', async () => {
      await using api = await TestApi.start()

      const response = await ingest(api, [])

      expect(response.status).toBe(400)
    })

    it('WHEN ingesting more than 1000 events THEN 400', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)

      const response = await ingest(api, usageBatch(customer.id, 1001))

      expect(response.status).toBe(400)
    })

    it('WHEN quantity and occurredAt are omitted THEN they default to 1 and the server time', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      await ingest(api, [{ customerId: customer.id, eventName: 'api_call', eventId: 'defaults' }])

      const usage = await (await api.client.customers[':customerId'].usage.current.$get({ param: { customerId: customer.id } })).json()

      expect(usage).toMatchObject({ eventCount: 1, totalQuantity: 1 })
    })

    it('WHEN occurredAt is 2 minutes in the future THEN it is accepted (clock drift tolerance)', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)

      const response = await ingest(api, [usageEventBody(customer.id, { occurredAt: isoMinutesFromNow(2) })])

      expect(await response.json()).toMatchObject({ inserted: 1, rejected: [] })
    })

    it('WHEN occurredAt is 10 minutes in the future THEN it is rejected as invalid', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)

      const response = await ingest(api, [usageEventBody(customer.id, { occurredAt: isoMinutesFromNow(10) })])

      expect(await response.json()).toMatchObject({ inserted: 0, rejected: [{ reason: 'invalid' }] })
    })

    it('WHEN eventName has surrounding spaces THEN it is stored trimmed', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      await ingest(api, [usageEventBody(customer.id, { eventName: '  api_call  ' })])

      const usage = await (await api.client.customers[':customerId'].usage.current.$get({ param: { customerId: customer.id } })).json()

      expect(usage.byEventName).toEqual([{ eventName: 'api_call', quantity: 1, count: 1 }])
    })

    it('WHEN a fractional quantity is sent THEN the 6 decimals are preserved', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      await ingest(api, [usageEventBody(customer.id, { quantity: 0.000001 })])

      const usage = await (await api.client.customers[':customerId'].usage.current.$get({ param: { customerId: customer.id } })).json()

      expect(usage.totalQuantity).toBe(0.000001)
    })

    it('WHEN a batch mixes two customers THEN each customer only sees its own events', async () => {
      await using api = await TestApi.start()
      const first = await givenBillableCustomer(api)
      const second = await givenCustomer(api)
      await ingest(api, [usageEventBody(first.id, { quantity: 1 }), usageEventBody(second.id, { quantity: 5 })])

      const usage = await (await api.client.customers[':customerId'].usage.current.$get({ param: { customerId: second.id } })).json()

      expect(usage).toMatchObject({ eventCount: 1, totalQuantity: 5 })
    })

    it.each([
      ['an object instead of an array', '{"customerId":"x"}'],
      ['invalid JSON', '[{oops'],
      ['an item without customerId', '[{"eventName":"api_call","eventId":"e"}]'],
    ])('WHEN the body is %s THEN 400 for the whole batch', async (_case, body) => {
      await using api = await TestApi.start()

      const response = await api.request('/webhooks/usage-events', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-idempotency-id': idempotencyKey() },
        body,
      })

      expect(response.status).toBe(400)
    })

    it('WHEN the idempotency key is longer than 200 characters THEN 400', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)

      const response = await ingest(api, [usageEventBody(customer.id)], 'k'.repeat(201))

      expect(response.status).toBe(400)
    })

    it('WHEN the idempotency key has surrounding spaces THEN it is matched trimmed', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      const batch = [usageEventBody(customer.id)]
      await givenIngestedEvents(api, batch, 'spaced')

      const replay = await ingest(api, batch, '  spaced  ')

      expect(replay.headers.get('idempotent-replayed')).toBe('true')
    })

    it('WHEN ingesting 1000 events THEN they are all stored', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)

      const response = await ingest(api, usageBatch(customer.id, 1000))

      expect(await response.json()).toMatchObject({ received: 1000, inserted: 1000, duplicates: 0, rejected: [] })
    })
  })

  describe('GIVEN an idempotency key already used', () => {
    it('WHEN replaying the same body THEN the stored response is replayed', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      const batch = [usageEventBody(customer.id)]
      const first = await givenIngestedEvents(api, batch, 'batch-1')

      const replay = await ingest(api, batch, 'batch-1')

      expect(replay.headers.get('idempotent-replayed')).toBe('true')
      expect(await replay.json()).toEqual(first)
    })

    it('WHEN replaying the same body THEN nothing is stored twice', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      const batch = [usageEventBody(customer.id, { quantity: 5 })]
      await givenIngestedEvents(api, batch, 'batch-1')
      await ingest(api, batch, 'batch-1')

      const usage = await (await api.client.customers[':customerId'].usage.current.$get({ param: { customerId: customer.id } })).json()

      expect(usage).toMatchObject({ eventCount: 1, totalQuantity: 5 })
    })

    it('WHEN sending a different body THEN 422 idempotency_mismatch', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      await givenIngestedEvents(api, [usageEventBody(customer.id)], 'key')

      const response = await ingest(api, [usageEventBody(customer.id)], 'key')

      expect(response.status).toBe(422)
      expect(await response.json()).toMatchObject({ code: 'idempotency_mismatch' })
    })

    it('WHEN the key is still being processed THEN 409 conflict', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      const batch = [usageEventBody(customer.id)]
      await sqlMarkIdempotencyKeyProcessing(api, 'in-flight', batch)

      const response = await ingest(api, batch, 'in-flight')

      expect(response.status).toBe(409)
    })

    it('WHEN the key has expired THEN the request is processed again instead of replayed', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      const batch = [usageEventBody(customer.id)]
      await givenIngestedEvents(api, batch, 'old-key')
      await sqlExpireIdempotencyKey(api, 'old-key')

      const response = await ingest(api, batch, 'old-key')

      expect(response.headers.get('idempotent-replayed')).toBeNull()
      expect(await response.json()).toMatchObject({ inserted: 0, duplicates: 1 })
    })

    it('WHEN stored THEN the key is valid for 72 hours', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      await givenIngestedEvents(api, [usageEventBody(customer.id)], 'ttl-key')

      const hours = await sqlIdempotencyKeyTtlHours(api, 'ttl-key')

      expect(hours).toBeCloseTo(72, 1)
    })
  })

  describe('GIVEN a key whose first call failed validation', () => {
    it('WHEN replaying it THEN the stored 400 is replayed (4xx responses are cached too)', async () => {
      await using api = await TestApi.start()
      await ingest(api, [], 'bad-batch')

      const replay = await ingest(api, [], 'bad-batch')

      expect(replay.status).toBe(400)
      expect(replay.headers.get('idempotent-replayed')).toBe('true')
    })
  })

  describe('GIVEN the same body sent under two different keys', () => {
    it('WHEN the second arrives THEN it is processed and reports the events as duplicates', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      const batch = [usageEventBody(customer.id), usageEventBody(customer.id)]
      await givenIngestedEvents(api, batch, 'key-a')

      const response = await ingest(api, batch, 'key-b')

      expect(response.headers.get('idempotent-replayed')).toBeNull()
      expect(await response.json()).toMatchObject({ inserted: 0, duplicates: 2 })
    })
  })

  describe('GIVEN no idempotency key', () => {
    it('WHEN ingesting THEN 400', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)

      const response = await api.client.webhooks['usage-events'].$post({ json: [usageEventBody(customer.id)] })

      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ message: expect.stringContaining('x-idempotency-id') })
    })
  })
})
