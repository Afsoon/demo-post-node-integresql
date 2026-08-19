import { Hono } from 'hono'
import type { AppEnv } from '../../../../shared/http/app-env.ts'
import { describeRoute, errorResponses, jsonResponse, validate } from '../../../../shared/http/openapi.ts'
import { IdParamSchema } from '../../../../shared/http/schemas.ts'
import { CustomerSchema, toCustomerResponse } from '../../schemas.ts'

export const getCustomerRoute = new Hono<AppEnv>().get(
  '/:id',
  describeRoute({
    tags: ['Customers'],
    summary: 'Get a customer',
    responses: {
      200: jsonResponse('Customer', CustomerSchema),
      400: errorResponses[400],
      401: errorResponses[401],
      404: errorResponses[404],
    },
  }),
  validate('param', IdParamSchema),
  async (c) => {
    const customer = await c.var.container.customers.get(c.req.valid('param').id)
    return c.json(toCustomerResponse(customer), 200)
  },
)
