import { HttpResponse, type HttpResponseResolver, http, passthrough } from 'msw'
import { setupServer } from 'msw/node'

export const POLAR_SANDBOX_URL = 'https://sandbox-api.polar.sh'

export type PolarCustomer = {
  id: string
  external_id: string | null
  email: string | null
  name: string | null
  type: 'individual' | 'team'
  metadata: Record<string, string | number | boolean>
  created_at: string
  modified_at: string | null
  deleted_at: string | null
}

export type PolarEvent = {
  name: string
  external_customer_id: string
  external_id: string
  timestamp: string
  metadata: Record<string, unknown>
}

export type PolarOrder = {
  id: string
  status: 'draft' | 'paid'
  paid: boolean
  customer_id: string
  product_id: string
  total_amount: number
  currency: string
  description: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export type RecordedRequest = { method: string; url: string; body: unknown }

type Json = Record<string, unknown>

const now = () => new Date().toISOString()
const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
const notFound = (what: string) => HttpResponse.json({ detail: `${what} not found` }, { status: 404 })
const validationError = (msg: string) =>
  HttpResponse.json({ detail: [{ loc: ['body'], msg, type: 'value_error' }] }, { status: 422 })

/**
 * Stateful in-memory double of the Polar endpoints our adapters use, served by an MSW server
 * that is private to one TestApi. Everything local passes through (integresql API), everything
 * else not listed here throws (`onUnhandledRequest: 'error'`).
 */
export function createPolarMock({ baseUrl = POLAR_SANDBOX_URL } = {}) {
  const state = {
    customers: new Map<string, PolarCustomer>(),
    events: [] as PolarEvent[],
    orders: new Map<string, PolarOrder>(),
  }
  const requests: RecordedRequest[] = []

  /** Records the call, then delegates — keeps handlers focused on behaviour. */
  const record =
    <P extends Record<string, string>>(resolver: (info: { params: P; body: Json }) => Response | Promise<Response>) =>
    (async ({ request, params }) => {
      const text = await request.text()
      const body = text ? (JSON.parse(text) as Json) : {}
      requests.push({ method: request.method, url: new URL(request.url).pathname, body: text ? body : undefined })
      return resolver({ params: params as P, body })
    }) satisfies HttpResponseResolver

  const handlers = [
    // Never interfere with local traffic (integresql HTTP API, anything on loopback)
    http.all('http://127.0.0.1*', () => passthrough()),
    http.all('http://localhost*', () => passthrough()),

    http.post(
      `${baseUrl}/v1/customers/`,
      record(({ body }) => {
        const type = (body.type as PolarCustomer['type'] | undefined) ?? 'individual'
        const email = (body.email as string | null | undefined) ?? null
        const externalId = (body.external_id as string | null | undefined) ?? null
        if (type === 'individual' && !email) return validationError('email is required for individual customers')
        for (const existing of state.customers.values()) {
          if (externalId && existing.external_id === externalId) {
            return HttpResponse.json({ detail: 'A customer with this external ID already exists.' }, { status: 409 })
          }
          if (email && existing.email === email) {
            return HttpResponse.json({ detail: 'A customer with this email already exists.' }, { status: 409 })
          }
        }
        const customer: PolarCustomer = {
          id: id('cus'),
          external_id: externalId,
          email,
          name: (body.name as string | null | undefined) ?? null,
          type,
          metadata: (body.metadata as PolarCustomer['metadata'] | undefined) ?? {},
          created_at: now(),
          modified_at: null,
          deleted_at: null,
        }
        state.customers.set(customer.id, customer)
        return HttpResponse.json(customer, { status: 201 })
      }),
    ),

    http.patch(
      `${baseUrl}/v1/customers/:id`,
      record<{ id: string }>(({ params, body }) => {
        const customer = state.customers.get(params.id)
        if (!customer) return notFound('Customer')
        const updated: PolarCustomer = { ...customer, ...body, id: customer.id, modified_at: now() }
        state.customers.set(customer.id, updated)
        return HttpResponse.json(updated)
      }),
    ),

    http.delete(
      `${baseUrl}/v1/customers/:id`,
      record<{ id: string }>(({ params }) => {
        if (!state.customers.delete(params.id)) return notFound('Customer')
        return new HttpResponse(null, { status: 204 })
      }),
    ),

    http.post(
      `${baseUrl}/v1/events/ingest`,
      record(({ body }) => {
        const events = (body.events as PolarEvent[] | undefined) ?? []
        let inserted = 0
        let duplicates = 0
        const known = new Set(state.events.map((e) => e.external_id))
        for (const event of events) {
          if (event.external_id && known.has(event.external_id)) {
            duplicates++
            continue
          }
          known.add(event.external_id)
          state.events.push(event)
          inserted++
        }
        return HttpResponse.json({ inserted, duplicates })
      }),
    ),

    http.post(
      `${baseUrl}/v1/orders/`,
      record(({ body }) => {
        const customerId = body.customer_id as string
        if (!state.customers.has(customerId)) return notFound('Customer')
        const order: PolarOrder = {
          id: id('ord'),
          status: 'draft',
          paid: false,
          customer_id: customerId,
          product_id: body.product_id as string,
          total_amount: (body.amount as number | undefined) ?? 0,
          currency: (body.currency as string | undefined) ?? 'usd',
          description: (body.description as string | undefined) ?? null,
          metadata: (body.metadata as Record<string, unknown> | undefined) ?? {},
          created_at: now(),
        }
        state.orders.set(order.id, order)
        return HttpResponse.json(order, { status: 201 })
      }),
    ),

    http.post(
      `${baseUrl}/v1/orders/:id/finalize`,
      record<{ id: string }>(({ params }) => {
        const order = state.orders.get(params.id)
        if (!order) return notFound('Order')
        const paid: PolarOrder = { ...order, status: 'paid', paid: true }
        state.orders.set(order.id, paid)
        return HttpResponse.json(paid)
      }),
    ),
  ]

  const server = setupServer(...handlers)

  return {
    baseUrl,
    server,
    state,
    requests,
    /** Per-instance overrides (e.g. force a 500); they vanish with the instance. */
    use: (...overrides: Parameters<typeof server.use>) => server.use(...overrides),
    // Anything not local and not a known Polar endpoint: MSW logs it and rejects the request
    // (the SDK call throws, the API answers 500). A thrown callback would become a 500 *response*
    // instead, which is why the built-in 'error' strategy is used.
    listen: () => server.listen({ onUnhandledRequest: 'error' }),
    close: () => server.close(),
  }
}

export type PolarMock = ReturnType<typeof createPolarMock>
