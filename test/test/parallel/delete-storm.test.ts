import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { usageBatch } from '../../factories/index.ts'
import { TestApi } from '../../support/api.ts'
import {
  givenBillableCustomers,
  givenIngestedEvents,
  givenUnlinkedCustomer,
  sqlCountSettlements,
  sqlCountUsageEvents,
  statusHistogram,
} from '../../support/fixtures.ts'

const deleteCustomer = (api: TestApi, id: string) => api.client.customers[':id'].$delete({ param: { id } })

describe('delete storm', () => {
  describe('GIVEN 20 billable customers with usage', () => {
    it('WHEN all are deleted concurrently THEN each is settled and charged', async () => {
      await using api = await TestApi.start()
      const customers = await givenBillableCustomers(api, 20)
      await givenIngestedEvents(api, customers.flatMap((c) => usageBatch(c.id, 5)))

      const responses = await Promise.all(customers.map((c) => deleteCustomer(api, c.id)))

      expect(statusHistogram(responses)).toEqual({ 200: 20 })
      const bodies = await Promise.all(responses.map((r) => r.json()))
      expect(bodies.every((b) => 'settlement' in b && b.settlement?.syncedEvents === 5 && b.settlement.charge?.amountCents === 35)).toBe(true)
    })

    it('WHEN all are deleted concurrently THEN Polar holds 20 orders and no customers', async () => {
      await using api = await TestApi.start()
      const customers = await givenBillableCustomers(api, 20)
      await givenIngestedEvents(api, customers.flatMap((c) => usageBatch(c.id, 5)))

      await Promise.all(customers.map((c) => deleteCustomer(api, c.id)))

      expect(api.polar.state.orders.size).toBe(20)
      expect(api.polar.state.customers.size).toBe(0)
    })

    it('WHEN all are deleted concurrently THEN one settlement row per customer is recorded and the events remain', async () => {
      await using api = await TestApi.start()
      const customers = await givenBillableCustomers(api, 20)
      await givenIngestedEvents(api, customers.flatMap((c) => usageBatch(c.id, 5)))

      await Promise.all(customers.map((c) => deleteCustomer(api, c.id)))

      const settlements = await Promise.all(customers.map((c) => sqlCountSettlements(api, c.id)))
      const events = await Promise.all(customers.map((c) => sqlCountUsageEvents(api, c.id)))
      expect(settlements).toEqual(Array(20).fill(1))
      expect(events).toEqual(Array(20).fill(5))
    })

    it('WHEN the same customer is deleted 5× concurrently THEN exactly one call succeeds', async () => {
      await using api = await TestApi.start()
      const [customer] = await givenBillableCustomers(api, 1)
      await givenIngestedEvents(api, usageBatch(customer!.id, 5))

      const responses = await Promise.all(Array.from({ length: 5 }, () => deleteCustomer(api, customer!.id)))

      const histogram = statusHistogram(responses)
      expect(histogram[200]).toBe(1)
      // losers see 404 (row already gone) or 502 (their settlement hit a Polar mirror the winner already deleted)
      expect((histogram[404] ?? 0) + (histogram[502] ?? 0)).toBe(4)
    })

    it('WHEN the same customer is deleted 5× concurrently THEN the usage is never lost but concurrent settlements may charge more than once (known limitation)', async () => {
      await using api = await TestApi.start()
      const [customer] = await givenBillableCustomers(api, 1)
      await givenIngestedEvents(api, usageBatch(customer!.id, 5))

      await Promise.all(Array.from({ length: 5 }, () => deleteCustomer(api, customer!.id)))

      expect(api.polar.state.orders.size).toBeLessThanOrEqual(5)
      expect([...api.polar.state.orders.values()].reduce((acc, o) => acc + o.total_amount, 0)).toBeGreaterThanOrEqual(35)
    })

    it('WHEN a customer is deleted THEN ingesting for it afterwards rejects the events as unknown customer', async () => {
      await using api = await TestApi.start()
      const [customer] = await givenBillableCustomers(api, 1)
      await deleteCustomer(api, customer!.id)

      const outcome = await givenIngestedEvents(api, usageBatch(customer!.id, 3))

      expect(outcome).toMatchObject({ inserted: 0, rejected: [{ reason: 'unknown_customer' }, { reason: 'unknown_customer' }, { reason: 'unknown_customer' }] })
    })
  })

  describe('GIVEN unlinked customers', () => {
    it('WHEN deleted concurrently THEN no settlement is attempted', async () => {
      await using api = await TestApi.start()
      const customers = [await givenUnlinkedCustomer(api), await givenUnlinkedCustomer(api), await givenUnlinkedCustomer(api)]

      const bodies = await Promise.all(customers.map(async (c) => (await deleteCustomer(api, c.id)).json()))

      expect(bodies.map((b) => ('settlement' in b ? b.settlement : 'error'))).toEqual([null, null, null])
    })
  })

  describe('GIVEN Polar failing for some customers', () => {
    it('WHEN deleting all concurrently THEN the failing ones are kept with 502 and the rest are gone', async () => {
      await using api = await TestApi.start()
      const customers = await givenBillableCustomers(api, 10)
      const failing = customers.slice(0, 3)
      for (const c of failing) {
        api.polar.use(http.delete(`${api.polar.baseUrl}/v1/customers/${c.polarCustomerId}`, () => HttpResponse.json({}, { status: 500 })))
      }

      const responses = await Promise.all(customers.map((c) => deleteCustomer(api, c.id)))

      expect(statusHistogram(responses)).toEqual({ 200: 7, 502: 3 })
      const reads = await Promise.all(failing.map((c) => api.client.customers[':id'].$get({ param: { id: c.id } })))
      expect(statusHistogram(reads)).toEqual({ 200: 3 })
    })

    it('WHEN Polar recovers THEN re-running the deletes succeeds', async () => {
      await using api = await TestApi.start()
      const customers = await givenBillableCustomers(api, 5)
      for (const c of customers) {
        api.polar.use(http.delete(`${api.polar.baseUrl}/v1/customers/${c.polarCustomerId}`, () => HttpResponse.json({}, { status: 500 })))
      }
      await Promise.all(customers.map((c) => deleteCustomer(api, c.id)))
      api.polar.resetHandlers()

      const responses = await Promise.all(customers.map((c) => deleteCustomer(api, c.id)))

      expect(statusHistogram(responses)).toEqual({ 200: 5 })
    })
  })
})
