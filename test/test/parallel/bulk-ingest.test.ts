import { describe, expect, it } from 'vitest'
import { idempotencyKey, usageBatch, usageEventBody } from '../../factories/index.ts'
import { TestApi } from '../../support/api.ts'
import {
  UNKNOWN_ID,
  givenBillableCustomer,
  givenCustomers,
  givenIngestedEvents,
  sqlCountUsageEvents,
} from '../../support/fixtures.ts'

const ingest = (api: TestApi, events: ReturnType<typeof usageEventBody>[], key = idempotencyKey()) =>
  api.client.webhooks['usage-events'].$post({ json: events }, { headers: { 'x-idempotency-id': key } })

const currentUsage = async (api: TestApi, customerId: string) =>
  (await api.client.customers[':customerId'].usage.current.$get({ param: { customerId } })).json()

describe('bulk ingestion', () => {
  describe('GIVEN a billable customer', () => {
    it('WHEN ingesting a 1000-event batch THEN every event is stored', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)

      const response = await ingest(api, usageBatch(customer.id, 1000))

      expect(await response.json()).toMatchObject({ received: 1000, inserted: 1000, duplicates: 0, rejected: [] })
    })

    it('WHEN the same 1000 events arrive under a second key THEN they are all duplicates', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      const batch = usageBatch(customer.id, 1000)
      await givenIngestedEvents(api, batch)

      const response = await ingest(api, batch)

      expect(await response.json()).toMatchObject({ inserted: 0, duplicates: 1000 })
    })

    it('WHEN 10 batches of 100 arrive concurrently under distinct keys THEN 1000 events are stored', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)

      const responses = await Promise.all(Array.from({ length: 10 }, () => ingest(api, usageBatch(customer.id, 100))))

      expect(responses.every((r) => r.status === 200)).toBe(true)
      expect(await sqlCountUsageEvents(api, customer.id)).toBe(1000)
    })

    it('WHEN the same 1000 events arrive in 5 concurrent batches under distinct keys THEN they are stored once', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      const batch = usageBatch(customer.id, 1000)

      const results = await Promise.all(Array.from({ length: 5 }, async () => (await ingest(api, batch)).json()))

      expect(results.reduce((acc, r) => acc + r.inserted, 0)).toBe(1000)
      expect(results.reduce((acc, r) => acc + r.duplicates, 0)).toBe(4000)
      expect(await sqlCountUsageEvents(api, customer.id)).toBe(1000)
    })

    it('WHEN half of a 1000-event batch targets an unknown customer THEN half is stored and half rejected', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      const batch = [...usageBatch(customer.id, 500), ...usageBatch(UNKNOWN_ID, 500)]

      const outcome = await (await ingest(api, batch)).json()

      expect(outcome).toMatchObject({ received: 1000, inserted: 500, duplicates: 0 })
      expect(outcome.rejected).toHaveLength(500)
    })

    it('WHEN replaying a 1000-event batch THEN the replayed body equals the original', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      const batch = usageBatch(customer.id, 1000)
      const first = await givenIngestedEvents(api, batch, 'bulk')

      const replay = await ingest(api, batch, 'bulk')

      expect(replay.headers.get('idempotent-replayed')).toBe('true')
      expect(await replay.json()).toEqual(first)
    })

    it('WHEN 1000 events of 0.001 units are ingested THEN the total is exactly 1', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      await givenIngestedEvents(api, usageBatch(customer.id, 1000, { quantity: 0.001 }))

      const usage = await currentUsage(api, customer.id)

      expect(usage).toMatchObject({ eventCount: 1000, totalQuantity: 1 })
    })
  })

  describe('GIVEN 10 customers', () => {
    it('WHEN one batch carries 100 events per customer THEN each customer sees exactly its 100', async () => {
      await using api = await TestApi.start()
      const customers = await givenCustomers(api, 10)
      await givenIngestedEvents(api, customers.flatMap((c) => usageBatch(c.id, 100)))

      const usages = await Promise.all(customers.map((c) => currentUsage(api, c.id)))

      expect(usages.map((u) => u.eventCount)).toEqual(Array(10).fill(100))
    })
  })
})
