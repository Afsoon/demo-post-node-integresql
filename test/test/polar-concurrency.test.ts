import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { createPolarMock } from '../support/polar-mock.ts'

describe('concurrent Polar mocks', () => {
  it.concurrent.each([401, 429, 503])('isolates a %i override and its reset from other tests', async (status) => {
    const polar = createPolarMock()
    const url = `${polar.baseUrl}/v1/customers/`
    const createCustomer = () => polar.run(() => fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'same@example.com' }),
    }))
    polar.use(http.post(url, () => new HttpResponse(null, { status })))
    await Promise.resolve()

    expect((await createCustomer()).status).toBe(status)
    polar.resetHandlers()
    expect((await createCustomer()).status).toBe(201)

    expect(polar.state.customers.size).toBe(1)
    expect(polar.requests).toHaveLength(1)
  })
})
