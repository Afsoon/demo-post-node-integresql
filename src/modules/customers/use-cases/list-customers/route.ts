import { Hono } from 'hono'
import type { AppEnv } from '../../../../shared/http/app-env.ts'
import { describeRoute, errorResponses, jsonResponse, validate } from '../../../../shared/http/openapi.ts'
import { toCustomerResponse } from '../../schemas.ts'
import { CustomerPageSchema, ListCustomersQuerySchema } from './schema.ts'

export const listCustomersRoute = new Hono<AppEnv>().get(
  '/',
  describeRoute({
    tags: ['Customers'],
    summary: 'List customers',
    description: 'Keyset pagination ordered by id (uuidv7, time ordered).',
    responses: {
      200: jsonResponse('Page of customers', CustomerPageSchema),
      400: errorResponses[400],
      401: errorResponses[401],
    },
  }),
  validate('query', ListCustomersQuerySchema),
  async (c) => {
    const page = await c.var.container.customers.list(c.req.valid('query'))
    return c.json({ items: page.items.map(toCustomerResponse), nextCursor: page.nextCursor }, 200)
  },
)
