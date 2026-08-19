import { describe, expect, it } from 'vitest'
import { billingProfileBody, isoDaysAgo, reportQuery, usageBatch, usageBatchSpread, usageEventBody } from '../../factories/index.ts'
import { TestApi } from '../../support/api.ts'
import { givenBillableCustomer, givenCustomers, givenIngestedEvents } from '../../support/fixtures.ts'

const bigLimit = billingProfileBody({ limits: { monthlyEventLimit: 100_000 } })

const report = async (api: TestApi, customerId: string, query = reportQuery()) =>
  (await api.client.customers[':customerId'].usage.$get({ param: { customerId }, query })).json()

const current = async (api: TestApi, customerId: string) =>
  (await api.client.customers[':customerId'].usage.current.$get({ param: { customerId } })).json()

describe('heavy reports', () => {
  describe('GIVEN 1000 events spread over the last 30 days', () => {
    it('WHEN reporting by day THEN the series has one row per day and sums to the totals', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api, bigLimit)
      await givenIngestedEvents(api, usageBatchSpread(customer.id, 1000, { days: 30 }))

      const result = await report(api, customer.id, reportQuery({ start: isoDaysAgo(31), end: isoDaysAgo(-1) }))

      expect(result.series.length).toBeGreaterThanOrEqual(30)
      expect(result.series.length).toBeLessThanOrEqual(31)
      expect(result.series.reduce((acc, r) => acc + r.count, 0)).toBe(1000)
      expect(result.series.reduce((acc, r) => acc + r.quantity, 0)).toBe(result.totals.totalQuantity)
    })

    it('WHEN reporting by hour THEN the series has at most 24 buckets per day', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api, bigLimit)
      await givenIngestedEvents(api, usageBatchSpread(customer.id, 1000, { days: 1 }))

      const result = await report(api, customer.id, reportQuery({ start: isoDaysAgo(2), end: isoDaysAgo(-1), bucket: 'hour' }))

      expect(result.series.length).toBeLessThanOrEqual(25)
      expect(result.totals.eventCount).toBe(1000)
    })

    it('WHEN reporting by month over a quarter THEN buckets collapse to months', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api, bigLimit)
      await givenIngestedEvents(api, [
        ...usageBatch(customer.id, 300, { occurredAt: '2026-01-15T00:00:00Z' }),
        ...usageBatch(customer.id, 300, { occurredAt: '2026-02-15T00:00:00Z' }),
        ...usageBatch(customer.id, 400, { occurredAt: '2026-03-15T00:00:00Z' }),
      ])

      const result = await report(api, customer.id, reportQuery({ start: '2026-01-01T00:00:00Z', end: '2026-04-01T00:00:00Z', bucket: 'month' }))

      expect(result.series.map((r) => r.count)).toEqual([300, 300, 400])
    })

    it('WHEN the range covers only a subset THEN totals and series only include that subset', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api, bigLimit)
      await givenIngestedEvents(api, [
        ...usageBatch(customer.id, 300, { occurredAt: '2026-01-15T00:00:00Z' }),
        ...usageBatch(customer.id, 400, { occurredAt: '2026-03-15T00:00:00Z' }),
      ])

      const result = await report(api, customer.id, reportQuery({ start: '2026-03-01T00:00:00Z', end: '2026-04-01T00:00:00Z' }))

      expect(result.totals.eventCount).toBe(400)
      expect(result.series.reduce((acc, r) => acc + r.count, 0)).toBe(400)
    })
  })

  describe('GIVEN 1000 events this month and a limit of 500', () => {
    it('WHEN reading current usage THEN the limit is exceeded with 0 remaining', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api, billingProfileBody({ limits: { monthlyEventLimit: 500 } }))
      await givenIngestedEvents(api, usageBatch(customer.id, 1000))

      const usage = await current(api, customer.id)

      expect(usage).toMatchObject({ eventCount: 1000, limit: { monthlyEventLimit: 500, remaining: 0, exceeded: true } })
    })
  })

  describe('GIVEN 5 event names with different volumes', () => {
    it('WHEN reading current usage THEN byEventName is ordered by quantity desc', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api, bigLimit)
      await givenIngestedEvents(api, [
        ...usageBatch(customer.id, 10, { eventName: 'a', quantity: 1 }),
        ...usageBatch(customer.id, 10, { eventName: 'b', quantity: 5 }),
        ...usageBatch(customer.id, 10, { eventName: 'c', quantity: 3 }),
        ...usageBatch(customer.id, 10, { eventName: 'd', quantity: 4 }),
        ...usageBatch(customer.id, 10, { eventName: 'e', quantity: 2 }),
      ])

      const usage = await current(api, customer.id)

      expect(usage.byEventName.map((r) => r.eventName)).toEqual(['b', 'd', 'c', 'e', 'a'])
    })
  })

  describe('GIVEN two customers with 500 events each', () => {
    it('WHEN reporting both THEN each report only counts its own events', async () => {
      await using api = await TestApi.start()
      const [first, second] = await givenCustomers(api, 2)
      await givenIngestedEvents(api, [...usageBatch(first!.id, 500, { quantity: 1 }), ...usageBatch(second!.id, 500, { quantity: 2 })])

      const [a, b] = await Promise.all([report(api, first!.id), report(api, second!.id)])

      expect(a.totals).toMatchObject({ eventCount: 500, totalQuantity: 500 })
      expect(b.totals).toMatchObject({ eventCount: 500, totalQuantity: 1000 })
    })

    it('WHEN 20 reports are requested concurrently THEN all answer consistently', async () => {
      await using api = await TestApi.start()
      const [customer] = await givenCustomers(api, 1)
      await givenIngestedEvents(api, usageBatch(customer!.id, 500))

      const results = await Promise.all(Array.from({ length: 20 }, () => report(api, customer!.id)))

      expect(new Set(results.map((r) => r.totals.eventCount))).toEqual(new Set([500]))
    })
  })
})
