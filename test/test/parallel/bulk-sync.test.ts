import { describe, expect, it } from 'vitest'
import { billingProfileBody, thisYear, usageBatch, usageEventBody } from '../../factories/index.ts'
import { TestApi } from '../../support/api.ts'
import {
  givenBillableCustomer,
  givenBillableCustomers,
  givenIngestedEvents,
  givenSyncedUsage,
  polarCalls,
} from '../../support/fixtures.ts'

const bigLimit = billingProfileBody({ limits: { monthlyEventLimit: 100_000 } })

const sync = async (api: TestApi, customerId: string) =>
  (await api.client.customers[':customerId'].usage.sync.$post({ param: { customerId }, json: thisYear })).json()

describe('bulk sync', () => {
  describe('GIVEN 1000 unsynced events', () => {
    it('WHEN syncing THEN all are synced in 2 chunks and charged once', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api, bigLimit)
      await givenIngestedEvents(api, usageBatch(customer.id, 1000))

      const settlement = await sync(api, customer.id)

      expect(settlement).toMatchObject({ syncedEvents: 1000, syncedQuantity: 1000, charge: { amountCents: 7000 } })
      expect(polarCalls(api).filter((c) => c === 'POST /v1/events/ingest')).toHaveLength(2)
      expect(api.polar.state.orders.size).toBe(1)
    })

    it('WHEN syncing THEN Polar holds exactly the synced events', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api, bigLimit)
      await givenIngestedEvents(api, usageBatch(customer.id, 1000))

      await sync(api, customer.id)

      expect(api.polar.state.events).toHaveLength(1000)
    })

    it('WHEN syncing a second time THEN nothing is synced', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api, bigLimit)
      await givenIngestedEvents(api, usageBatch(customer.id, 1000))
      await givenSyncedUsage(api, customer.id, thisYear)

      const settlement = await sync(api, customer.id)

      expect(settlement).toMatchObject({ syncedEvents: 0, charge: null })
    })

    it('WHEN deleting the customer THEN the 1000 events are settled first', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api, bigLimit)
      await givenIngestedEvents(api, usageBatch(customer.id, 1000))

      const deleted = await (await api.client.customers[':id'].$delete({ param: { id: customer.id } })).json()

      expect(deleted.settlement).toMatchObject({ syncedEvents: 1000, charge: { amountCents: 7000 } })
    })
  })

  describe('GIVEN 1200 unsynced events', () => {
    it('WHEN syncing THEN they are forwarded in 3 chunks', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api, bigLimit)
      await givenIngestedEvents(api, usageBatch(customer.id, 1000))
      await givenIngestedEvents(api, usageBatch(customer.id, 200))

      const settlement = await sync(api, customer.id)

      expect(settlement.syncedEvents).toBe(1200)
      expect(polarCalls(api).filter((c) => c === 'POST /v1/events/ingest')).toHaveLength(3)
    })
  })

  describe('GIVEN 1000 fractional events', () => {
    it('WHEN syncing THEN the charge is rounded once on the total', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api, bigLimit)
      await givenIngestedEvents(api, usageBatch(customer.id, 1000, { quantity: 0.0015 }))

      const settlement = await sync(api, customer.id)

      expect(settlement).toMatchObject({ syncedQuantity: 1.5, charge: { amountCents: 11 } })
    })
  })

  describe('GIVEN events arriving between two syncs', () => {
    it('WHEN syncing again THEN only the new events are charged', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api, bigLimit)
      await givenIngestedEvents(api, usageBatch(customer.id, 500))
      await givenSyncedUsage(api, customer.id, thisYear)
      await givenIngestedEvents(api, usageBatch(customer.id, 300))

      const settlement = await sync(api, customer.id)

      expect(settlement).toMatchObject({ syncedEvents: 300, charge: { amountCents: 2100 } })
    })
  })

  describe('GIVEN 5 customers with 200 events each', () => {
    it('WHEN syncing them one after another THEN each gets its own order', async () => {
      await using api = await TestApi.start()
      const customers = await givenBillableCustomers(api, 5, bigLimit)
      await givenIngestedEvents(api, customers.flatMap((c) => usageBatch(c.id, 200)))

      const settlements = []
      for (const customer of customers) settlements.push(await sync(api, customer.id))

      expect(settlements.map((s) => s.syncedEvents)).toEqual([200, 200, 200, 200, 200])
      expect(api.polar.state.orders.size).toBe(5)
      expect(new Set([...api.polar.state.orders.values()].map((o) => o.customer_id)).size).toBe(5)
    })
  })
})
