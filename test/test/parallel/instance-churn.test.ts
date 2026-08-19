import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { customerBody, usageBatch } from '../../factories/index.ts'
import { TestApi } from '../../support/api.ts'
import { givenBillableCustomer, givenCustomer, givenIngestedEvents } from '../../support/fixtures.ts'

const listCount = async (api: TestApi) => (await (await api.client.customers.$get({ query: {} })).json()).items.length

describe('instance churn', () => {
  describe('GIVEN a worker leasing many api instances one after another', () => {
    it('WHEN 20 instances are started and disposed sequentially THEN each starts with an empty database and an empty Polar', async () => {
      const observations: { customers: number; polar: number }[] = []

      for (let i = 0; i < 20; i++) {
        await using api = await TestApi.start()
        observations.push({ customers: await listCount(api), polar: api.polar.state.customers.size })
        await givenCustomer(api)
      }

      expect(observations).toEqual(Array(20).fill({ customers: 0, polar: 0 }))
    })

    it('WHEN an instance wrote data and was disposed THEN the next instance does not see it', async () => {
      {
        await using previous = await TestApi.start()
        await givenBillableCustomer(previous)
      }

      await using api = await TestApi.start()

      expect(await listCount(api)).toBe(0)
    })

    it('WHEN an instance overrode Polar and was disposed THEN the next instance has a healthy Polar', async () => {
      {
        await using previous = await TestApi.start()
        previous.polar.use(http.post(`${previous.polar.baseUrl}/v1/customers/`, () => HttpResponse.json({}, { status: 500 })))
      }
      await using api = await TestApi.start()

      const response = await api.client.customers.$post({ json: customerBody() })

      expect(response.status).toBe(201)
    })

    it('WHEN an instance is fresh THEN it has recorded no Polar requests', async () => {
      await using api = await TestApi.start()

      const requests = api.polar.requests

      expect(requests).toEqual([])
    })

    it('WHEN 30 leases have been taken THEN integresql still serves a usable clone', async () => {
      for (let i = 0; i < 30; i++) {
        await using api = await TestApi.start()
        await givenCustomer(api)
      }

      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      const outcome = await givenIngestedEvents(api, usageBatch(customer.id, 10))

      expect(outcome.inserted).toBe(10)
    })

    it('WHEN 50 instances are leased in a loop THEN it completes in a reasonable time', async () => {
      const started = performance.now()

      for (let i = 0; i < 50; i++) {
        await using api = await TestApi.start()
        expect((await api.client.health.$get()).status).toBe(200)
      }

      expect(performance.now() - started).toBeLessThan(30_000)
    })

    it('WHEN an instance did heavy work THEN the next one starts clean regardless', async () => {
      {
        await using previous = await TestApi.start()
        const customer = await givenBillableCustomer(previous)
        await givenIngestedEvents(previous, usageBatch(customer.id, 1000))
      }
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)

      const usage = await (await api.client.customers[':customerId'].usage.current.$get({ param: { customerId: customer.id } })).json()

      expect(usage.eventCount).toBe(0)
    })

    it('WHEN an instance fails mid-test THEN disposal still runs and the next instance is clean', async () => {
      await expect(async () => {
        await using api = await TestApi.start()
        await givenCustomer(api)
        throw new Error('simulated test failure')
      }).rejects.toThrow('simulated test failure')

      await using api = await TestApi.start()

      expect(await listCount(api)).toBe(0)
    })
  })
})
