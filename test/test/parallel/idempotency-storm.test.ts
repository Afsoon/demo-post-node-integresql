import { describe, expect, it } from 'vitest'
import { idempotencyKey, usageBatch, usageEventBody } from '../../factories/index.ts'
import { TestApi } from '../../support/api.ts'
import {
  givenBillableCustomer,
  givenIngestedEvents,
  sqlCountUsageEvents,
  sqlExpireIdempotencyKey,
  sqlIdempotencyKeyTtlHours,
  statusHistogram,
} from '../../support/fixtures.ts'

const ingest = (api: TestApi, events: ReturnType<typeof usageEventBody>[], key = idempotencyKey()) =>
  api.client.webhooks['usage-events'].$post({ json: events }, { headers: { 'x-idempotency-id': key } })

describe('idempotency storm', () => {
  describe('GIVEN one key and one body', () => {
    it('WHEN sent 10× concurrently THEN every answer is 200 or 409 and the events are stored once', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      const batch = usageBatch(customer.id, 50)

      const responses = await Promise.all(Array.from({ length: 10 }, () => ingest(api, batch, 'storm')))

      const histogram = statusHistogram(responses)
      expect(Object.keys(histogram).map(Number).every((s) => s === 200 || s === 409)).toBe(true)
      expect(histogram[200]).toBeGreaterThanOrEqual(1)
      expect(await sqlCountUsageEvents(api, customer.id)).toBe(50)
    })

    it('WHEN the completed key is replayed 10× concurrently THEN all replays are served from the store', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      const batch = usageBatch(customer.id, 50)
      await givenIngestedEvents(api, batch, 'done')

      const responses = await Promise.all(Array.from({ length: 10 }, () => ingest(api, batch, 'done')))

      expect(responses.every((r) => r.status === 200 && r.headers.get('idempotent-replayed') === 'true')).toBe(true)
    })

    it('WHEN the same key is reused with 10 different bodies concurrently THEN at most one is processed', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)

      const responses = await Promise.all(Array.from({ length: 10 }, () => ingest(api, usageBatch(customer.id, 5), 'contested')))

      const histogram = statusHistogram(responses)
      expect(histogram[200] ?? 0).toBeLessThanOrEqual(1)
      expect((histogram[422] ?? 0) + (histogram[409] ?? 0) + (histogram[200] ?? 0)).toBe(10)
      expect(await sqlCountUsageEvents(api, customer.id)).toBeLessThanOrEqual(5)
    })

    it('WHEN the key expired THEN 5 concurrent resends reprocess it once', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      const batch = usageBatch(customer.id, 20)
      await givenIngestedEvents(api, batch, 'expired')
      await sqlExpireIdempotencyKey(api, 'expired')

      const responses = await Promise.all(Array.from({ length: 5 }, () => ingest(api, batch, 'expired')))

      expect(responses.some((r) => r.status === 200 && r.headers.get('idempotent-replayed') === null)).toBe(true)
      expect(await sqlCountUsageEvents(api, customer.id)).toBe(20)
    })
  })

  describe('GIVEN many keys', () => {
    it('WHEN 50 keys carry the same body concurrently THEN the batch is stored once and the rest are duplicates', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      const batch = usageBatch(customer.id, 20)

      const results = await Promise.all(Array.from({ length: 50 }, async () => (await ingest(api, batch)).json()))

      expect(results.reduce((acc, r) => acc + r.inserted, 0)).toBe(20)
      expect(results.reduce((acc, r) => acc + r.duplicates, 0)).toBe(980)
    })

    it('WHEN 100 keys carry 100 distinct bodies concurrently THEN all are processed', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)

      const responses = await Promise.all(Array.from({ length: 100 }, () => ingest(api, usageBatch(customer.id, 10))))

      expect(statusHistogram(responses)).toEqual({ 200: 100 })
      expect(await sqlCountUsageEvents(api, customer.id)).toBe(1000)
    })

    it('WHEN 20 keys of 200 characters are used THEN all are accepted', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)

      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, i) => ingest(api, usageBatch(customer.id, 2), `${i}`.padStart(200, 'k'))),
      )

      expect(statusHistogram(responses)).toEqual({ 200: 20 })
    })

    it('WHEN keys are stored under load THEN each keeps the 72h validity', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      const keys = Array.from({ length: 10 }, (_, i) => `ttl-${i}`)
      await Promise.all(keys.map((key) => ingest(api, usageBatch(customer.id, 2), key)))

      const hours = await Promise.all(keys.map((key) => sqlIdempotencyKeyTtlHours(api, key)))

      expect(hours.every((h) => Math.abs(h - 72) < 0.1)).toBe(true)
    })
  })
})
