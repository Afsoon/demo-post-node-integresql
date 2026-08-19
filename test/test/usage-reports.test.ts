import { describe, expect, it } from 'vitest'
import {
  billingProfileBody,
  isoDaysAgo,
  lastMonthDate,
  lastMonthEnd,
  monthStart,
  reportQuery,
  usageEventBody,
} from '../factories/index.ts'
import { TestApi } from '../support/api.ts'
import { UNKNOWN_ID, givenBillableCustomer, givenCustomer, givenIngestedEvents, givenUnlinkedCustomer } from '../support/fixtures.ts'

describe('usage reports', () => {
  describe('GIVEN a billable customer with events this month', () => {
    it('WHEN reading current usage THEN totals and limit status are aggregated', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      await givenIngestedEvents(api, [
        usageEventBody(customer.id, { quantity: 2 }),
        usageEventBody(customer.id, { eventName: 'tokens', quantity: 10.5 }),
      ])

      const response = await api.client.customers[':customerId'].usage.current.$get({ param: { customerId: customer.id } })

      expect(await response.json()).toMatchObject({
        customerId: customer.id,
        totalQuantity: 12.5,
        eventCount: 2,
        byEventName: [
          { eventName: 'tokens', quantity: 10.5, count: 1 },
          { eventName: 'api_call', quantity: 2, count: 1 },
        ],
        limit: { monthlyEventLimit: 10, remaining: 8, hardLimit: true, exceeded: false },
      })
    })

    it('WHEN the event count passes the monthly limit THEN the limit is reported as exceeded', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api, billingProfileBody({ limits: { monthlyEventLimit: 2 } }))
      await givenIngestedEvents(api, [usageEventBody(customer.id), usageEventBody(customer.id), usageEventBody(customer.id)])

      const usage = await (await api.client.customers[':customerId'].usage.current.$get({ param: { customerId: customer.id } })).json()

      expect(usage.limit).toEqual({ monthlyEventLimit: 2, remaining: 0, hardLimit: true, exceeded: true })
    })

    it('WHEN the event count equals the monthly limit THEN remaining is 0 but not exceeded', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api, billingProfileBody({ limits: { monthlyEventLimit: 2 } }))
      await givenIngestedEvents(api, [usageEventBody(customer.id), usageEventBody(customer.id)])

      const usage = await (await api.client.customers[':customerId'].usage.current.$get({ param: { customerId: customer.id } })).json()

      expect(usage.limit).toMatchObject({ remaining: 0, exceeded: false })
    })

    it('WHEN events sit on the month boundary THEN the first instant of this month counts and the last of the previous does not', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      await givenIngestedEvents(api, [
        usageEventBody(customer.id, { quantity: 1, occurredAt: monthStart() }),
        usageEventBody(customer.id, { quantity: 100, occurredAt: lastMonthEnd() }),
      ])

      const usage = await (await api.client.customers[':customerId'].usage.current.$get({ param: { customerId: customer.id } })).json()

      expect(usage).toMatchObject({ eventCount: 1, totalQuantity: 1 })
    })

    it("WHEN another customer has events THEN they are not counted in this customer's usage", async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      const other = await givenCustomer(api)
      await givenIngestedEvents(api, [usageEventBody(other.id, { quantity: 50 })])

      const usage = await (await api.client.customers[':customerId'].usage.current.$get({ param: { customerId: customer.id } })).json()

      expect(usage).toMatchObject({ eventCount: 0, totalQuantity: 0, byEventName: [] })
    })

    it('WHEN an event is dated last month THEN it is excluded from current usage', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      await givenIngestedEvents(api, [
        usageEventBody(customer.id, { quantity: 1 }),
        usageEventBody(customer.id, { quantity: 100, occurredAt: lastMonthDate() }),
      ])

      const usage = await (await api.client.customers[':customerId'].usage.current.$get({ param: { customerId: customer.id } })).json()

      expect(usage).toMatchObject({ eventCount: 1, totalQuantity: 1 })
    })
  })

  describe('GIVEN a customer without a billing profile', () => {
    it('WHEN reading current usage THEN the limit is null', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)
      await givenIngestedEvents(api, [usageEventBody(customer.id)])

      const usage = await (await api.client.customers[':customerId'].usage.current.$get({ param: { customerId: customer.id } })).json()

      expect(usage).toMatchObject({ eventCount: 1, limit: null })
    })
  })

  describe('GIVEN a customer not linked to Polar', () => {
    it('WHEN reading current usage THEN it works like for any customer', async () => {
      await using api = await TestApi.start()
      const customer = await givenUnlinkedCustomer(api)
      await givenIngestedEvents(api, [usageEventBody(customer.id)])

      const response = await api.client.customers[':customerId'].usage.current.$get({ param: { customerId: customer.id } })

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ eventCount: 1, limit: null })
    })
  })

  describe('GIVEN an unknown customer', () => {
    it('WHEN reading current usage THEN 404', async () => {
      await using api = await TestApi.start()

      const response = await api.client.customers[':customerId'].usage.current.$get({ param: { customerId: UNKNOWN_ID } })

      expect(response.status).toBe(404)
    })

    it('WHEN requesting a report THEN 404', async () => {
      await using api = await TestApi.start()

      const response = await api.client.customers[':customerId'].usage.$get({ param: { customerId: UNKNOWN_ID }, query: reportQuery() })

      expect(response.status).toBe(404)
    })
  })

  describe('GIVEN events spread over two days', () => {
    it('WHEN requesting the report THEN totals are summed over the range', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      await givenIngestedEvents(api, [
        usageEventBody(customer.id, { quantity: 3, occurredAt: isoDaysAgo(2) }),
        usageEventBody(customer.id, { quantity: 1, occurredAt: isoDaysAgo(1) }),
        usageEventBody(customer.id, { eventName: 'tokens', quantity: 10, occurredAt: isoDaysAgo(1) }),
      ])

      const report = await (
        await api.client.customers[':customerId'].usage.$get({ param: { customerId: customer.id }, query: reportQuery() })
      ).json()

      expect(report.totals).toEqual({
        totalQuantity: 14,
        eventCount: 3,
        byEventName: [
          { eventName: 'tokens', quantity: 10, count: 1 },
          { eventName: 'api_call', quantity: 4, count: 2 },
        ],
      })
    })

    it('WHEN requesting the report THEN the series has one bucket per day, ordered', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      await givenIngestedEvents(api, [
        usageEventBody(customer.id, { quantity: 3, occurredAt: isoDaysAgo(2) }),
        usageEventBody(customer.id, { quantity: 1, occurredAt: isoDaysAgo(1) }),
        usageEventBody(customer.id, { quantity: 10, occurredAt: isoDaysAgo(1) }),
      ])

      const report = await (
        await api.client.customers[':customerId'].usage.$get({ param: { customerId: customer.id }, query: reportQuery() })
      ).json()

      expect(report.bucket).toBe('day')
      expect(report.series).toEqual([
        { bucketStart: isoDaysAgo(2).slice(0, 10) + 'T00:00:00.000Z', quantity: 3, count: 1 },
        { bucketStart: isoDaysAgo(1).slice(0, 10) + 'T00:00:00.000Z', quantity: 11, count: 2 },
      ])
    })

    it('WHEN bucketing by month THEN the series collapses into monthly rows', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      await givenIngestedEvents(api, [
        usageEventBody(customer.id, { quantity: 3, occurredAt: '2026-03-02T10:00:00Z' }),
        usageEventBody(customer.id, { quantity: 1, occurredAt: '2026-03-20T10:00:00Z' }),
        usageEventBody(customer.id, { quantity: 5, occurredAt: '2026-04-01T10:00:00Z' }),
      ])

      const report = await (
        await api.client.customers[':customerId'].usage.$get({
          param: { customerId: customer.id },
          query: reportQuery({ start: '2026-03-01T00:00:00Z', end: '2026-05-01T00:00:00Z', bucket: 'month' }),
        })
      ).json()

      expect(report.series).toEqual([
        { bucketStart: '2026-03-01T00:00:00.000Z', quantity: 4, count: 2 },
        { bucketStart: '2026-04-01T00:00:00.000Z', quantity: 5, count: 1 },
      ])
    })

    it('WHEN bucketing by hour THEN events in the same hour share a bucket', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      await givenIngestedEvents(api, [
        usageEventBody(customer.id, { quantity: 1, occurredAt: '2026-03-02T10:05:00Z' }),
        usageEventBody(customer.id, { quantity: 2, occurredAt: '2026-03-02T10:55:00Z' }),
        usageEventBody(customer.id, { quantity: 4, occurredAt: '2026-03-02T11:00:00Z' }),
      ])

      const report = await (
        await api.client.customers[':customerId'].usage.$get({
          param: { customerId: customer.id },
          query: reportQuery({ start: '2026-03-02T00:00:00Z', end: '2026-03-03T00:00:00Z', bucket: 'hour' }),
        })
      ).json()

      expect(report.series).toEqual([
        { bucketStart: '2026-03-02T10:00:00.000Z', quantity: 3, count: 2 },
        { bucketStart: '2026-03-02T11:00:00.000Z', quantity: 4, count: 1 },
      ])
    })

    it('WHEN bucketing by week THEN buckets start on Mondays (TimescaleDB epoch)', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      await givenIngestedEvents(api, [
        usageEventBody(customer.id, { quantity: 1, occurredAt: '2026-03-03T10:00:00Z' }), // Tuesday
        usageEventBody(customer.id, { quantity: 2, occurredAt: '2026-03-08T10:00:00Z' }), // Sunday, same week
        usageEventBody(customer.id, { quantity: 4, occurredAt: '2026-03-09T10:00:00Z' }), // next Monday
      ])

      const report = await (
        await api.client.customers[':customerId'].usage.$get({
          param: { customerId: customer.id },
          query: reportQuery({ start: '2026-03-01T00:00:00Z', end: '2026-04-01T00:00:00Z', bucket: 'week' }),
        })
      ).json()

      expect(report.series).toEqual([
        { bucketStart: '2026-03-02T00:00:00.000Z', quantity: 3, count: 2 },
        { bucketStart: '2026-03-09T00:00:00.000Z', quantity: 4, count: 1 },
      ])
    })

    it('WHEN an event sits exactly at start THEN it is included (start is inclusive)', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      await givenIngestedEvents(api, [usageEventBody(customer.id, { quantity: 3, occurredAt: '2026-03-01T00:00:00Z' })])

      const report = await (
        await api.client.customers[':customerId'].usage.$get({
          param: { customerId: customer.id },
          query: reportQuery({ start: '2026-03-01T00:00:00Z', end: '2026-03-02T00:00:00Z' }),
        })
      ).json()

      expect(report.totals).toMatchObject({ eventCount: 1, totalQuantity: 3 })
    })

    it('WHEN the range has no events THEN totals are zero and the series is empty', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)

      const report = await (
        await api.client.customers[':customerId'].usage.$get({ param: { customerId: customer.id }, query: reportQuery() })
      ).json()

      expect(report).toMatchObject({ totals: { totalQuantity: 0, eventCount: 0, byEventName: [] }, series: [] })
    })

    it('WHEN the range spans exactly 366 days THEN it is accepted', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)

      const response = await api.client.customers[':customerId'].usage.$get({
        param: { customerId: customer.id },
        query: reportQuery({ start: '2025-01-01T00:00:00Z', end: '2026-01-02T00:00:00Z' }),
      })

      expect(response.status).toBe(200)
    })

    it('WHEN the range ends before an event THEN that event is excluded (end is exclusive)', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      await givenIngestedEvents(api, [
        usageEventBody(customer.id, { quantity: 3, occurredAt: '2026-03-02T10:00:00Z' }),
        usageEventBody(customer.id, { quantity: 5, occurredAt: '2026-04-01T00:00:00Z' }),
      ])

      const report = await (
        await api.client.customers[':customerId'].usage.$get({
          param: { customerId: customer.id },
          query: reportQuery({ start: '2026-03-01T00:00:00Z', end: '2026-04-01T00:00:00Z' }),
        })
      ).json()

      expect(report.totals).toMatchObject({ eventCount: 1, totalQuantity: 3 })
    })
  })

  describe('GIVEN an invalid report query', () => {
    it.each([
      ['end before start', reportQuery({ start: '2026-02-01T00:00:00Z', end: '2026-01-01T00:00:00Z' })],
      ['range over 366 days', reportQuery({ start: '2024-01-01T00:00:00Z', end: '2026-01-01T00:00:00Z' })],
      ['missing end', { start: '2026-01-01T00:00:00Z' } as ReturnType<typeof reportQuery>],
      ['unknown bucket', { ...reportQuery(), bucket: 'year' } as unknown as ReturnType<typeof reportQuery>],
    ])('WHEN the query has %s THEN 400', async (_case, query) => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)

      const response = await api.client.customers[':customerId'].usage.$get({ param: { customerId: customer.id }, query })

      expect(response.status).toBe(400)
    })
  })
})
