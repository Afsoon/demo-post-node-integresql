import { describe, expect, it } from 'vitest'
import { customerBody, customerPatch, usageEventBody } from '../factories/index.ts'
import { TestApi } from '../support/api.ts'
import {
  UNKNOWN_ID,
  givenBillingProfile,
  givenCustomer,
  givenIngestedEvents,
  polarCalls,
  sqlCountUsageEvents,
} from '../support/fixtures.ts'

describe('customers', () => {
  describe('GIVEN no customers', () => {
    it('WHEN creating one with a mixed-case email THEN it is stored normalized and active', async () => {
      await using api = await TestApi.start()

      const response = await api.client.customers.$post({ json: customerBody({ email: 'Ada@Example.com' }) })

      expect(response.status).toBe(201)
      expect(await response.json()).toMatchObject({ email: 'ada@example.com', name: 'Ada Lovelace', status: 'active' })
    })

    it('WHEN creating one with metadata THEN the metadata is stored', async () => {
      await using api = await TestApi.start()

      const customer = await (await api.client.customers.$post({ json: customerBody({ metadata: { tier: 'beta', seats: 3 } }) })).json()

      expect(customer.metadata).toEqual({ tier: 'beta', seats: 3 })
    })

    it('WHEN creating one THEN it is linked to a Polar customer id', async () => {
      await using api = await TestApi.start()

      const customer = await (await api.client.customers.$post({ json: customerBody() })).json()

      expect(customer.polarCustomerId).toMatch(/^cus_/)
    })

    it('WHEN creating one THEN Polar receives a mirror keyed by our id as external_id', async () => {
      await using api = await TestApi.start()

      const customer = await (await api.client.customers.$post({ json: customerBody({ type: 'team' }) })).json()

      expect([...api.polar.state.customers.values()]).toEqual([
        expect.objectContaining({ external_id: customer.id, email: customer.email, type: 'team' }),
      ])
    })

    it('WHEN creating one with an invalid body THEN 400 listing each invalid field', async () => {
      await using api = await TestApi.start()

      const response = await api.request('/customers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'nope', name: '', type: 'alien' }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        code: 'validation_error',
        details: [{ path: ['email'] }, { path: ['name'] }, { path: ['type'] }],
      })
    })

    it('WHEN listing THEN the page is empty', async () => {
      await using api = await TestApi.start()

      const response = await api.client.customers.$get({ query: {} })

      expect(await response.json()).toEqual({ items: [], nextCursor: null })
    })

    it('WHEN requesting an unknown id THEN 404', async () => {
      await using api = await TestApi.start()

      const response = await api.client.customers[':id'].$get({ param: { id: UNKNOWN_ID } })

      expect(response.status).toBe(404)
    })

    it('WHEN requesting a malformed id THEN 400', async () => {
      await using api = await TestApi.start()

      const response = await api.client.customers[':id'].$get({ param: { id: 'not-a-uuid' } })

      expect(response.status).toBe(400)
    })

    it('WHEN creating one with a name over 200 characters THEN 400', async () => {
      await using api = await TestApi.start()

      const response = await api.client.customers.$post({ json: customerBody({ name: 'x'.repeat(201) }) })

      expect(response.status).toBe(400)
    })

    it('WHEN creating one with a nested object as metadata value THEN 400', async () => {
      await using api = await TestApi.start()

      const response = await api.request('/customers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(customerBody({ metadata: { nested: { deep: true } } as never })),
      })

      expect(response.status).toBe(400)
    })

    it('WHEN creating one with more than 50 metadata keys THEN 422 from the domain', async () => {
      await using api = await TestApi.start()
      const metadata = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, i]))

      const response = await api.client.customers.$post({ json: customerBody({ metadata }) })

      expect(response.status).toBe(422)
      expect(await response.json()).toMatchObject({ code: 'domain_validation', message: expect.stringContaining('metadata') })
    })

    it.each([
      ['limit 0', { limit: '0' }],
      ['limit above 100', { limit: '101' }],
      ['a malformed cursor', { cursor: 'not-a-uuid' }],
    ])('WHEN listing with %s THEN 400', async (_case, query) => {
      await using api = await TestApi.start()

      const response = await api.client.customers.$get({ query })

      expect(response.status).toBe(400)
    })
  })

  describe('GIVEN several customers', () => {
    it('WHEN listing with a limit THEN a page with a cursor is returned in id order', async () => {
      await using api = await TestApi.start()
      const first = await givenCustomer(api)
      const second = await givenCustomer(api)
      await givenCustomer(api)

      const page = await (await api.client.customers.$get({ query: { limit: '2' } })).json()

      expect(page).toEqual({ items: [first, second], nextCursor: second.id })
    })

    it('WHEN following the cursor THEN the remaining customers are returned without a next cursor', async () => {
      await using api = await TestApi.start()
      await givenCustomer(api)
      const second = await givenCustomer(api)
      const third = await givenCustomer(api)

      const page = await (await api.client.customers.$get({ query: { limit: '2', cursor: second.id } })).json()

      expect(page).toEqual({ items: [third], nextCursor: null })
    })

    it('WHEN listing without a limit THEN 20 customers per page', async () => {
      await using api = await TestApi.start()
      for (let i = 0; i < 21; i++) await givenCustomer(api)

      const page = await (await api.client.customers.$get({ query: {} })).json()

      expect(page.items).toHaveLength(20)
      expect(page.nextCursor).toBe(page.items.at(-1)?.id)
    })
  })

  describe('GIVEN two concurrent creations with the same email', () => {
    it('WHEN both hit the database THEN exactly one wins and the other gets 409', async () => {
      await using api = await TestApi.start()

      const responses = await Promise.all([
        api.client.customers.$post({ json: customerBody({ email: 'race@example.com' }) }),
        api.client.customers.$post({ json: customerBody({ email: 'race@example.com' }) }),
      ])

      expect(responses.map((r) => r.status).sort()).toEqual([201, 409])
    })
  })

  describe('GIVEN two api instances', () => {
    it('WHEN a customer is created in one THEN the other does not see it', async () => {
      await using api = await TestApi.start()
      await using other = await TestApi.start()
      await givenCustomer(api)

      const page = await (await other.client.customers.$get({ query: {} })).json()

      expect(page.items).toEqual([])
    })
  })

  describe('GIVEN an existing customer', () => {
    it('WHEN reading it by id THEN the stored representation is returned', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)

      const response = await api.client.customers[':id'].$get({ param: { id: customer.id } })

      expect(await response.json()).toEqual(customer)
    })

    it('WHEN creating another with the same email in a different case THEN 409 conflict', async () => {
      await using api = await TestApi.start()
      await givenCustomer(api, { email: 'ada@example.com' })

      const response = await api.client.customers.$post({ json: customerBody({ email: 'ADA@example.com' }) })

      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ code: 'conflict' })
    })

    it('WHEN patching name and status THEN the updated customer is returned', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)

      const response = await api.client.customers[':id'].$patch({
        param: { id: customer.id },
        json: customerPatch({ name: 'Ada L.', status: 'suspended' }),
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ id: customer.id, name: 'Ada L.', status: 'suspended', email: customer.email })
    })

    it('WHEN patching the email THEN the Polar mirror is updated too', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)

      await api.client.customers[':id'].$patch({ param: { id: customer.id }, json: { email: 'new@example.com' } })

      expect(api.polar.state.customers.get(customer.polarCustomerId!)).toMatchObject({ email: 'new@example.com' })
      expect(polarCalls(api).at(-1)).toBe(`PATCH /v1/customers/${customer.polarCustomerId}`)
    })

    it('WHEN patching metadata THEN it replaces the stored metadata and Polar receives it', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api, { metadata: { tier: 'beta', seats: 3 } })

      const updated = await (
        await api.client.customers[':id'].$patch({ param: { id: customer.id }, json: { metadata: { tier: 'pro' } } })
      ).json()

      expect(updated.metadata).toEqual({ tier: 'pro' })
      expect(api.polar.state.customers.get(customer.polarCustomerId!)?.metadata).toEqual({ tier: 'pro' })
    })

    it('WHEN patching the email to its own value in another case THEN 200 and the email is unchanged', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api, { email: 'ada@example.com' })

      const response = await api.client.customers[':id'].$patch({ param: { id: customer.id }, json: { email: 'ADA@Example.com' } })

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ email: 'ada@example.com' })
    })

    it('WHEN patching only the status THEN Polar is not called', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)

      await api.client.customers[':id'].$patch({ param: { id: customer.id }, json: { status: 'suspended' } })

      expect(polarCalls(api)).toEqual(['POST /v1/customers/'])
    })

    it('WHEN patching with an empty body THEN 400', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)

      const response = await api.client.customers[':id'].$patch({ param: { id: customer.id }, json: {} })

      expect(response.status).toBe(400)
    })

    it('WHEN patching the name to blanks THEN 422 with the domain issue', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)

      const response = await api.client.customers[':id'].$patch({ param: { id: customer.id }, json: { name: '   ' } })

      expect(response.status).toBe(422)
      expect(await response.json()).toMatchObject({ code: 'domain_validation', details: { issues: { nested: { name: expect.any(Array) } } } })
    })

    it("WHEN patching the email to another customer's THEN 409 conflict", async () => {
      await using api = await TestApi.start()
      await givenCustomer(api, { email: 'taken@example.com' })
      const customer = await givenCustomer(api)

      const response = await api.client.customers[':id'].$patch({ param: { id: customer.id }, json: { email: 'taken@example.com' } })

      expect(response.status).toBe(409)
    })

    it('WHEN patching an unknown id THEN 404', async () => {
      await using api = await TestApi.start()

      const response = await api.client.customers[':id'].$patch({ param: { id: UNKNOWN_ID }, json: customerPatch() })

      expect(response.status).toBe(404)
    })

    it('WHEN deleting it THEN 200 with an empty settlement', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)

      const response = await api.client.customers[':id'].$delete({ param: { id: customer.id } })

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ customerId: customer.id, settlement: { syncedEvents: 0, charge: null } })
    })

    it('WHEN deleting it THEN its Polar mirror is deleted', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)

      await api.client.customers[':id'].$delete({ param: { id: customer.id } })

      expect(api.polar.state.customers.size).toBe(0)
      expect(polarCalls(api).at(-1)).toBe(`DELETE /v1/customers/${customer.polarCustomerId}`)
    })

    it('WHEN deleting it THEN it is gone', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)
      await api.client.customers[':id'].$delete({ param: { id: customer.id } })

      const response = await api.client.customers[':id'].$get({ param: { id: customer.id } })

      expect(response.status).toBe(404)
    })

    it('WHEN deleting it THEN its usage events stay in the hypertable', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)
      await givenIngestedEvents(api, [usageEventBody(customer.id), usageEventBody(customer.id)])

      await api.client.customers[':id'].$delete({ param: { id: customer.id } })

      expect(await sqlCountUsageEvents(api, customer.id)).toBe(2)
    })

    it('WHEN deleting an unknown id THEN 404', async () => {
      await using api = await TestApi.start()

      const response = await api.client.customers[':id'].$delete({ param: { id: UNKNOWN_ID } })

      expect(response.status).toBe(404)
    })
  })

  describe('GIVEN a customer with a billing profile', () => {
    it('WHEN deleting the customer THEN the billing profile is deleted with it', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)
      await givenBillingProfile(api, customer.id)
      await api.client.customers[':id'].$delete({ param: { id: customer.id } })

      const response = await api.client.customers[':customerId']['billing-profile'].$get({ param: { customerId: customer.id } })

      expect(response.status).toBe(404)
    })
  })
})
