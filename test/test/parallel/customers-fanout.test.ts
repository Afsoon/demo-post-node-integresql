import { describe, expect, it } from 'vitest'
import { customerBody } from '../../factories/index.ts'
import { TestApi } from '../../support/api.ts'
import { givenCustomers, statusHistogram } from '../../support/fixtures.ts'

describe('customers fan-out', () => {
  describe('GIVEN no customers', () => {
    it('WHEN 100 customers are created concurrently THEN all succeed and Polar mirrors all of them', async () => {
      await using api = await TestApi.start()

      const responses = await Promise.all(Array.from({ length: 100 }, () => api.client.customers.$post({ json: customerBody() })))

      expect(statusHistogram(responses)).toEqual({ 201: 100 })
      expect(api.polar.state.customers.size).toBe(100)
    })

    it('WHEN 20 creates race on the same email THEN exactly one wins', async () => {
      await using api = await TestApi.start()

      const responses = await Promise.all(
        Array.from({ length: 20 }, () => api.client.customers.$post({ json: customerBody({ email: 'race@example.com' }) })),
      )

      expect(statusHistogram(responses)).toEqual({ 201: 1, 409: 19 })
    })

    it('WHEN 20 creates race on case variants of one email THEN exactly one wins', async () => {
      await using api = await TestApi.start()

      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, i) => api.client.customers.$post({ json: customerBody({ email: i % 2 ? 'Race@Example.com' : 'race@example.com' }) })),
      )

      expect(statusHistogram(responses)).toEqual({ 201: 1, 409: 19 })
    })

    it('WHEN 20 metadata-heavy customers are created concurrently THEN all are stored', async () => {
      await using api = await TestApi.start()
      const metadata = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i]))

      const responses = await Promise.all(Array.from({ length: 20 }, () => api.client.customers.$post({ json: customerBody({ metadata }) })))

      expect(statusHistogram(responses)).toEqual({ 201: 20 })
    })
  })

  describe('GIVEN 100 customers', () => {
    it('WHEN paginating with 20 per page THEN 5 pages cover everyone without gaps or duplicates', async () => {
      await using api = await TestApi.start()
      const customers = await givenCustomers(api, 100)

      const seen: string[] = []
      let cursor: string | undefined
      let pages = 0
      do {
        const page = await (await api.client.customers.$get({ query: { limit: '20', ...(cursor && { cursor }) } })).json()
        seen.push(...page.items.map((c) => c.id))
        cursor = page.nextCursor ?? undefined
        pages++
      } while (cursor)

      expect(pages).toBe(5)
      expect(new Set(seen).size).toBe(100)
      expect(new Set(seen)).toEqual(new Set(customers.map((c) => c.id)))
    })

    it('WHEN 100 reads run concurrently THEN all succeed', async () => {
      await using api = await TestApi.start()
      const customers = await givenCustomers(api, 100)

      const responses = await Promise.all(customers.map((c) => api.client.customers[':id'].$get({ param: { id: c.id } })))

      expect(statusHistogram(responses)).toEqual({ 200: 100 })
    })
  })

  describe('GIVEN 50 customers', () => {
    it('WHEN all are patched concurrently THEN every update lands locally and in Polar', async () => {
      await using api = await TestApi.start()
      const customers = await givenCustomers(api, 50)

      const responses = await Promise.all(
        customers.map((c, i) => api.client.customers[':id'].$patch({ param: { id: c.id }, json: { name: `Renamed ${i}` } })),
      )

      expect(statusHistogram(responses)).toEqual({ 200: 50 })
      expect([...api.polar.state.customers.values()].map((c) => c.name).sort()).toEqual(
        customers.map((_, i) => `Renamed ${i}`).sort(),
      )
    })

    it('WHEN all are deleted concurrently THEN the list and Polar end up empty', async () => {
      await using api = await TestApi.start()
      const customers = await givenCustomers(api, 50)

      const responses = await Promise.all(customers.map((c) => api.client.customers[':id'].$delete({ param: { id: c.id } })))

      expect(statusHistogram(responses)).toEqual({ 200: 50 })
      expect((await (await api.client.customers.$get({ query: {} })).json()).items).toEqual([])
      expect(api.polar.state.customers.size).toBe(0)
    })
  })
})
