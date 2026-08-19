import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { customerBody, thisYear, usageEventBody } from '../factories/index.ts'
import { TestApi } from '../support/api.ts'
import { givenBillableCustomer, givenCustomer, givenIngestedEvents, sqlCountSettlements } from '../support/fixtures.ts'

const polarDown = (api: TestApi, method: 'post' | 'patch' | 'delete', path: string, status = 500) =>
  api.polar.use(http[method](`${api.polar.baseUrl}${path}`, () => HttpResponse.json({ detail: 'upstream exploded' }, { status })))

describe('Polar failures', () => {
  describe('GIVEN Polar answering 500 on customer creation', () => {
    it('WHEN creating a customer THEN 502 billing_provider_error', async () => {
      await using api = await TestApi.start()
      polarDown(api, 'post', '/v1/customers/')

      const response = await api.client.customers.$post({ json: customerBody() })

      expect(response.status).toBe(502)
      expect(await response.json()).toMatchObject({ code: 'billing_provider_error' })
    })

    it('WHEN creating a customer THEN the local row is kept without a Polar link (retryable)', async () => {
      await using api = await TestApi.start()
      polarDown(api, 'post', '/v1/customers/')
      await api.client.customers.$post({ json: customerBody({ email: 'ada@example.com' }) })

      const list = await (await api.client.customers.$get({ query: {} })).json()

      expect(list.items).toEqual([expect.objectContaining({ email: 'ada@example.com', polarCustomerId: null })])
    })
  })

  describe('GIVEN Polar failing in other ways on customer creation', () => {
    it.each([
      ['rate limiting (429)', () => HttpResponse.json({ detail: 'slow down' }, { status: 429 })],
      ['a network error', () => HttpResponse.error()],
      ['409 already exists', () => HttpResponse.json({ detail: 'A customer with this email already exists.' }, { status: 409 })],
    ])('WHEN Polar answers with %s THEN 502 billing_provider_error', async (_case, resolver) => {
      await using api = await TestApi.start()
      api.polar.use(http.post(`${api.polar.baseUrl}/v1/customers/`, resolver))

      const response = await api.client.customers.$post({ json: customerBody() })

      expect(response.status).toBe(502)
    })
  })

  describe('GIVEN Polar answering 500 on customer update', () => {
    it('WHEN patching the email THEN 502 but the local email is already updated (known limitation)', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)
      polarDown(api, 'patch', `/v1/customers/${customer.polarCustomerId}`)

      const response = await api.client.customers[':id'].$patch({ param: { id: customer.id }, json: { email: 'new@example.com' } })

      expect(response.status).toBe(502)
      expect(await (await api.client.customers[':id'].$get({ param: { id: customer.id } })).json()).toMatchObject({ email: 'new@example.com' })
    })
  })

  describe('GIVEN Polar answering 500 on customer deletion', () => {
    it('WHEN deleting the customer THEN 502 and the customer still exists (retryable)', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)
      polarDown(api, 'delete', `/v1/customers/${customer.polarCustomerId}`)

      const response = await api.client.customers[':id'].$delete({ param: { id: customer.id } })

      expect(response.status).toBe(502)
      expect((await api.client.customers[':id'].$get({ param: { id: customer.id } })).status).toBe(200)
    })
  })

  describe('GIVEN Polar answering 500 on order finalization', () => {
    it('WHEN syncing THEN 502, the events stay marked synced and no settlement is recorded (known limitation)', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      await givenIngestedEvents(api, [usageEventBody(customer.id, { quantity: 3 })])
      api.polar.use(http.post(`${api.polar.baseUrl}/v1/orders/:id/finalize`, () => HttpResponse.json({ detail: 'boom' }, { status: 500 })))

      const response = await api.client.customers[':customerId'].usage.sync.$post({ param: { customerId: customer.id }, json: thisYear })

      expect(response.status).toBe(502)
      expect(await sqlCountSettlements(api, customer.id)).toBe(0)
      expect(
        await (await api.client.customers[':customerId'].usage.sync.$post({ param: { customerId: customer.id }, json: thisYear })).json(),
      ).toMatchObject({ syncedEvents: 0, charge: null })
    })
  })

  describe('GIVEN Polar answering 500 on event ingestion', () => {
    it('WHEN syncing usage THEN 502 and no order is created', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      await givenIngestedEvents(api, [usageEventBody(customer.id, { quantity: 3 })])
      polarDown(api, 'post', '/v1/events/ingest')

      const response = await api.client.customers[':customerId'].usage.sync.$post({ param: { customerId: customer.id }, json: thisYear })

      expect(response.status).toBe(502)
      expect(api.polar.state.orders.size).toBe(0)
    })

    it('WHEN syncing usage THEN the events stay unsynced for a later retry', async () => {
      await using api = await TestApi.start()
      const customer = await givenBillableCustomer(api)
      await givenIngestedEvents(api, [usageEventBody(customer.id, { quantity: 3 })])
      polarDown(api, 'post', '/v1/events/ingest')
      await api.client.customers[':customerId'].usage.sync.$post({ param: { customerId: customer.id }, json: thisYear })
      api.polar.server.resetHandlers()

      const retry = await (
        await api.client.customers[':customerId'].usage.sync.$post({ param: { customerId: customer.id }, json: thisYear })
      ).json()

      expect(retry).toMatchObject({ syncedEvents: 1, syncedQuantity: 3, charge: { amountCents: 21 } })
    })
  })

  describe('GIVEN the Polar mirror was already deleted upstream', () => {
    it('WHEN deleting the customer THEN the 404 from Polar is ignored and the customer is deleted', async () => {
      await using api = await TestApi.start()
      const customer = await givenCustomer(api)
      polarDown(api, 'delete', `/v1/customers/${customer.polarCustomerId}`, 404)

      const response = await api.client.customers[':id'].$delete({ param: { id: customer.id } })

      expect(response.status).toBe(200)
    })
  })

  describe('GIVEN a previous api instance forced Polar to fail', () => {
    it('WHEN a new api instance creates a customer THEN it succeeds (overrides do not leak)', async () => {
      {
        await using previous = await TestApi.start()
        polarDown(previous, 'post', '/v1/customers/')
      }
      await using api = await TestApi.start()

      const response = await api.client.customers.$post({ json: customerBody() })

      expect(response.status).toBe(201)
    })
  })

  describe('GIVEN a live api instance', () => {
    it('WHEN fetching a non-Polar URL THEN the request is rejected', async () => {
      await using api = await TestApi.start()

      const attempt = fetch('https://example.com/not-polar')

      await expect(attempt).rejects.toThrow()
      expect(api.polar.requests).toEqual([])
    })

    it('WHEN starting another api instance THEN local integresql traffic still passes through', async () => {
      await using api = await TestApi.start()

      await using other = await TestApi.start()

      expect((await other.client.health.$get()).status).toBe(200)
      expect(other).not.toBe(api)
    })
  })
})
