import { describe, expect, it } from 'vitest'
import { billingProfileBody, billingProfilePatch } from '../factories/index.ts'
import { TestApi } from '../support/api.ts'
import { UNKNOWN_ID, givenBillingProfile, givenCustomer } from '../support/fixtures.ts'

describe('billing profiles', () => {
  describe('GIVEN a customer without a billing profile', () => {
    it('WHEN creating one THEN it is stored normalized with the defaults applied', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)

      const response = await api.client.customers[':customerId']['billing-profile'].$post({
        param: { customerId: customer.id },
        json: billingProfileBody({
          company: { taxId: '  ', billingEmail: 'Billing@Ada.IO', address: { country: 'gb' } },
          pricing: { currency: 'eur' },
        }),
      })

      expect(response.status).toBe(201)
      expect(await response.json()).toMatchObject({
        customerId: customer.id,
        company: { taxId: null, billingEmail: 'billing@ada.io', address: { country: 'GB' } },
        limits: { hardLimit: true },
        pricing: { currency: 'EUR', includedUnits: 0 },
      })
    })

    it('WHEN reading it THEN 404', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)

      const response = await api.client.customers[':customerId']['billing-profile'].$get({ param: { customerId: customer.id } })

      expect(response.status).toBe(404)
    })

    it('WHEN creating one for an unknown customer THEN 404', async () => {
      await using api = await TestApi.start()

      const response = await api.client.customers[':customerId']['billing-profile'].$post({
        param: { customerId: UNKNOWN_ID },
        json: billingProfileBody(),
      })

      expect(response.status).toBe(404)
    })

    it('WHEN creating one with an invalid body THEN 400', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)

      const response = await api.request(`/customers/${customer.id}/billing-profile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ company: { legalName: 'x' } }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code: 'validation_error' })
    })

    it('WHEN creating a free plan with a unit price THEN 422 on pricing.pricePerUnitCents', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)

      const response = await api.client.customers[':customerId']['billing-profile'].$post({
        param: { customerId: customer.id },
        json: billingProfileBody({ pricing: { plan: 'free', pricePerUnitCents: 1 } }),
      })

      expect(response.status).toBe(422)
      expect(await response.json()).toMatchObject({
        code: 'domain_validation',
        details: { issues: { nested: { 'pricing.pricePerUnitCents': ['free plan cannot have a unit price'] } } },
      })
    })

    it.each([
      ['a 3-letter country', { company: { address: { country: 'ESP' } } }],
      ['a negative unit price', { pricing: { pricePerUnitCents: -1 } }],
      ['a zero monthly limit', { limits: { monthlyEventLimit: 0 } }],
    ])('WHEN creating one with %s THEN 400', async (_case, overrides) => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)

      const response = await api.client.customers[':customerId']['billing-profile'].$post({
        param: { customerId: customer.id },
        json: billingProfileBody(overrides),
      })

      expect(response.status).toBe(400)
    })

    it('WHEN creating one with optional fields THEN they are stored (taxId trimmed)', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)

      const profile = await (
        await api.client.customers[':customerId']['billing-profile'].$post({
          param: { customerId: customer.id },
          json: billingProfileBody({
            company: { taxId: ' ES123 ', address: { line2: 'Floor 2', state: 'Greater London' } },
            limits: { hardLimit: false },
            pricing: { includedUnits: 5 },
          }),
        })
      ).json()

      expect(profile).toMatchObject({
        company: { taxId: 'ES123', address: { line2: 'Floor 2', state: 'Greater London' } },
        limits: { hardLimit: false },
        pricing: { includedUnits: 5 },
      })
    })

    it('WHEN creating one with more included units than the monthly limit THEN 422', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)

      const response = await api.client.customers[':customerId']['billing-profile'].$post({
        param: { customerId: customer.id },
        json: billingProfileBody({ limits: { monthlyEventLimit: 10 }, pricing: { includedUnits: 11 } }),
      })

      expect(response.status).toBe(422)
      expect(await response.json()).toMatchObject({ message: expect.stringContaining('includedUnits') })
    })
  })

  describe('GIVEN an unknown customer', () => {
    it.each(['$get', '$patch', '$delete'] as const)('WHEN calling %s on its billing profile THEN 404', async (method) => {
      await using api = await TestApi.start()
      const route = api.client.customers[':customerId']['billing-profile']
      const param = { customerId: UNKNOWN_ID }

      const response =
        method === '$get'
          ? await route.$get({ param })
          : method === '$patch'
            ? await route.$patch({ param, json: billingProfilePatch() })
            : await route.$delete({ param })

      expect(response.status).toBe(404)
    })
  })

  describe('GIVEN a customer with a billing profile', () => {
    it('WHEN creating another one THEN 409 conflict', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)
      await givenBillingProfile(api, customer.id)

      const response = await api.client.customers[':customerId']['billing-profile'].$post({
        param: { customerId: customer.id },
        json: billingProfileBody(),
      })

      expect(response.status).toBe(409)
    })

    it('WHEN reading it THEN the stored profile is returned', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)
      const profile = await givenBillingProfile(api, customer.id)

      const response = await api.client.customers[':customerId']['billing-profile'].$get({ param: { customerId: customer.id } })

      expect(await response.json()).toEqual(profile)
    })

    it('WHEN patching a nested address field THEN it is merged with the stored address', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)
      await givenBillingProfile(api, customer.id)

      const response = await api.client.customers[':customerId']['billing-profile'].$patch({
        param: { customerId: customer.id },
        json: { company: { address: { line2: 'Floor 2' } } },
      })

      expect(await response.json()).toMatchObject({
        company: { legalName: 'Ada Ltd', address: { line1: '1 Main St', line2: 'Floor 2', country: 'GB' } },
      })
    })

    it('WHEN patching limits THEN the other sections are untouched', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)
      const profile = await givenBillingProfile(api, customer.id)

      const updated = await (
        await api.client.customers[':customerId']['billing-profile'].$patch({
          param: { customerId: customer.id },
          json: billingProfilePatch({ limits: { rateLimitPerMinute: 120 } }),
        })
      ).json()

      expect(updated).toMatchObject({ ...profile, limits: { ...profile.limits, rateLimitPerMinute: 120 }, updatedAt: expect.any(String) })
    })

    it('WHEN downgrading to free with a zero price THEN the change is accepted', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)
      await givenBillingProfile(api, customer.id)

      const response = await api.client.customers[':customerId']['billing-profile'].$patch({
        param: { customerId: customer.id },
        json: { pricing: { plan: 'free', pricePerUnitCents: 0 } },
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ pricing: { plan: 'free', pricePerUnitCents: 0 } })
    })

    it('WHEN downgrading to free but keeping the unit price THEN 422', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)
      await givenBillingProfile(api, customer.id)

      const response = await api.client.customers[':customerId']['billing-profile'].$patch({
        param: { customerId: customer.id },
        json: { pricing: { plan: 'free' } },
      })

      expect(response.status).toBe(422)
    })

    it('WHEN lowering the monthly limit below the included units THEN 422', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)
      await givenBillingProfile(api, customer.id, billingProfileBody({ limits: { monthlyEventLimit: 100 }, pricing: { includedUnits: 50 } }))

      const response = await api.client.customers[':customerId']['billing-profile'].$patch({
        param: { customerId: customer.id },
        json: { limits: { monthlyEventLimit: 10 } },
      })

      expect(response.status).toBe(422)
    })

    it('WHEN patching with an empty body THEN 400', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)
      await givenBillingProfile(api, customer.id)

      const response = await api.client.customers[':customerId']['billing-profile'].$patch({ param: { customerId: customer.id }, json: {} })

      expect(response.status).toBe(400)
    })

    it('WHEN deleting it THEN 204 and it can no longer be read', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)
      await givenBillingProfile(api, customer.id)

      const deleted = await api.client.customers[':customerId']['billing-profile'].$delete({ param: { customerId: customer.id } })

      expect(deleted.status).toBe(204)
      expect((await api.client.customers[':customerId']['billing-profile'].$get({ param: { customerId: customer.id } })).status).toBe(404)
    })

    it('WHEN deleting it twice THEN the second call is 404', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)
      await givenBillingProfile(api, customer.id)
      await api.client.customers[':customerId']['billing-profile'].$delete({ param: { customerId: customer.id } })

      const response = await api.client.customers[':customerId']['billing-profile'].$delete({ param: { customerId: customer.id } })

      expect(response.status).toBe(404)
    })
  })
})
