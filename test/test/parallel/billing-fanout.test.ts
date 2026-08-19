import { describe, expect, it } from 'vitest'
import { billingProfileBody } from '../../factories/index.ts'
import { TestApi } from '../../support/api.ts'
import { givenBillableCustomers, givenCustomers, statusHistogram } from '../../support/fixtures.ts'

describe('billing profiles fan-out', () => {
  describe('GIVEN 50 customers', () => {
    it('WHEN 50 profiles are created concurrently THEN all succeed', async () => {
      await using api = await TestApi.start()
      const customers = await givenCustomers(api, 50)

      const responses = await Promise.all(
        customers.map((c) => api.client.customers[':customerId']['billing-profile'].$post({ param: { customerId: c.id }, json: billingProfileBody() })),
      )

      expect(statusHistogram(responses)).toEqual({ 201: 50 })
    })

    it('WHEN 50 creates race for one customer THEN exactly one profile is created', async () => {
      await using api = await TestApi.start()
      const [customer] = await givenCustomers(api, 1)

      const responses = await Promise.all(
        Array.from({ length: 50 }, () =>
          api.client.customers[':customerId']['billing-profile'].$post({ param: { customerId: customer!.id }, json: billingProfileBody() }),
        ),
      )

      expect(statusHistogram(responses)).toEqual({ 201: 1, 409: 49 })
    })
  })

  describe('GIVEN 50 customers with profiles', () => {
    it('WHEN all profiles are patched concurrently THEN every patch lands', async () => {
      await using api = await TestApi.start()
      const customers = await givenBillableCustomers(api, 50)

      const responses = await Promise.all(
        customers.map((c, i) =>
          api.client.customers[':customerId']['billing-profile'].$patch({ param: { customerId: c.id }, json: { limits: { rateLimitPerMinute: 100 + i } } }),
        ),
      )

      expect(statusHistogram(responses)).toEqual({ 200: 50 })
      const profiles = await Promise.all(responses.map((r) => r.json()))
      expect(profiles.map((p) => ('limits' in p ? p.limits.rateLimitPerMinute : -1)).sort((a, b) => a - b)).toEqual(
        customers.map((_, i) => 100 + i),
      )
    })

    it('WHEN mixed plan updates run concurrently THEN each profile gets its own plan', async () => {
      await using api = await TestApi.start()
      const customers = await givenBillableCustomers(api, 50)

      const responses = await Promise.all(
        customers.map((c, i) =>
          api.client.customers[':customerId']['billing-profile'].$patch({
            param: { customerId: c.id },
            json: { pricing: i % 2 ? { plan: 'enterprise' } : { plan: 'free', pricePerUnitCents: 0 } },
          }),
        ),
      )

      const plans = (await Promise.all(responses.map((r) => r.json()))).map((p) => ('pricing' in p ? p.pricing.plan : 'error'))
      expect(plans.filter((p) => p === 'enterprise')).toHaveLength(25)
      expect(plans.filter((p) => p === 'free')).toHaveLength(25)
    })

    it('WHEN invariant-breaking patches run concurrently THEN all are 422 and nothing changes', async () => {
      await using api = await TestApi.start()
      const customers = await givenBillableCustomers(api, 50)

      const responses = await Promise.all(
        customers.map((c) => api.client.customers[':customerId']['billing-profile'].$patch({ param: { customerId: c.id }, json: { pricing: { plan: 'free' } } })),
      )

      expect(statusHistogram(responses)).toEqual({ 422: 50 })
      const profile = await (await api.client.customers[':customerId']['billing-profile'].$get({ param: { customerId: customers[0]!.id } })).json()
      expect(profile).toMatchObject({ pricing: { plan: 'pro', pricePerUnitCents: 7 } })
    })

    it('WHEN current usage is read for all 50 concurrently THEN every answer carries the limit', async () => {
      await using api = await TestApi.start()
      const customers = await givenBillableCustomers(api, 50)

      const usages = await Promise.all(
        customers.map(async (c) => (await api.client.customers[':customerId'].usage.current.$get({ param: { customerId: c.id } })).json()),
      )

      expect(usages.every((u) => u.limit?.monthlyEventLimit === 10)).toBe(true)
    })

    it('WHEN all profiles are deleted concurrently THEN all 204 and none can be read', async () => {
      await using api = await TestApi.start()
      const customers = await givenBillableCustomers(api, 50)

      const responses = await Promise.all(
        customers.map((c) => api.client.customers[':customerId']['billing-profile'].$delete({ param: { customerId: c.id } })),
      )

      expect(statusHistogram(responses)).toEqual({ 204: 50 })
      const reads = await Promise.all(customers.map((c) => api.client.customers[':customerId']['billing-profile'].$get({ param: { customerId: c.id } })))
      expect(statusHistogram(reads)).toEqual({ 404: 50 })
    })

    it('WHEN all customers are deleted concurrently THEN the 50 profiles cascade away', async () => {
      await using api = await TestApi.start()
      const customers = await givenBillableCustomers(api, 50)

      await Promise.all(customers.map((c) => api.client.customers[':id'].$delete({ param: { id: c.id } })))

      const reads = await Promise.all(customers.map((c) => api.client.customers[':customerId']['billing-profile'].$get({ param: { customerId: c.id } })))
      expect(statusHistogram(reads)).toEqual({ 404: 50 })
    })
  })
})
