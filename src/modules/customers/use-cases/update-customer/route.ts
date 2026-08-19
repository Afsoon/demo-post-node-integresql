import { Hono } from 'hono'
import type { AppEnv } from '../../../../shared/http/app-env.ts'
import { describeRoute, errorResponses, jsonResponse, validate } from '../../../../shared/http/openapi.ts'
import { IdParamSchema } from '../../../../shared/http/schemas.ts'
import { CustomerSchema, toCustomerResponse } from '../../schemas.ts'
import { UpdateCustomerBodySchema } from './schema.ts'

export const updateCustomerRoute = new Hono<AppEnv>().patch(
  '/:id',
  describeRoute({
    tags: ['Customers'],
    summary: 'Update a customer',
    responses: {
      200: jsonResponse('Updated customer', CustomerSchema),
      400: errorResponses[400],
      401: errorResponses[401],
      404: errorResponses[404],
      409: errorResponses[409],
      422: errorResponses[422],
      502: errorResponses[502],
    },
  }),
  validate('param', IdParamSchema),
  validate('json', UpdateCustomerBodySchema),
  async (c) => {
    const customer = await c.var.container.customers.update(c.req.valid('param').id, c.req.valid('json'))
    return c.json(toCustomerResponse(customer), 200)
  },
)
