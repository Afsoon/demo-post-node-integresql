import { describe, expect, it } from 'vitest'
import { usageEventBody } from '../factories/index.ts'
import { TestApi } from '../support/api.ts'
import { UNKNOWN_ID } from '../support/fixtures.ts'

describe('auth', () => {
  describe('GIVEN a protected route', () => {
    it('WHEN called without Authorization THEN 401 with a Bearer challenge', async () => {
      await using api = await TestApi.start()

      const response = await api.anonymous.customers.$get({ query: {} })

      expect(response.status).toBe(401)
      expect(response.headers.get('www-authenticate')).toContain('Bearer')
    })

    it('WHEN called with a wrong token THEN 401 unauthorized', async () => {
      await using api = await TestApi.start()

      const response = await api.request('/customers', { headers: { authorization: 'Bearer nope' } })

      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({ code: 'unauthorized', message: 'Invalid token' })
    })

    it('WHEN called with a malformed Authorization header THEN 400', async () => {
      await using api = await TestApi.start()

      const response = await api.request('/customers', { headers: { authorization: 'Basic abc' } })

      expect(response.status).toBe(400)
    })

    it('WHEN the webhook is called without a token THEN 401', async () => {
      await using api = await TestApi.start()

      const response = await api.anonymous.webhooks['usage-events'].$post(
        { json: [usageEventBody(UNKNOWN_ID)] },
        { headers: { 'x-idempotency-id': 'k' } },
      )

      expect(response.status).toBe(401)
    })

    it('WHEN called with the configured token THEN the route is reached', async () => {
      await using api = await TestApi.start()

      const response = await api.client.customers.$get({ query: {} })

      expect(response.status).toBe(200)
    })
  })
})
