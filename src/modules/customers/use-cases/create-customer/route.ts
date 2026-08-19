import { Hono } from 'hono'
import type { AppEnv } from '../../../../shared/http/app-env.ts'
import { describeRoute, errorResponses, jsonResponse, validate } from '../../../../shared/http/openapi.ts'
import { CustomerSchema, toCustomerResponse } from '../../schemas.ts'
import { CreateCustomerBodySchema } from './schema.ts'

export const createCustomerRoute = new Hono<AppEnv>().post(
  '/',
  describeRoute({
    tags: ['Customers'],
    summary: 'Create a customer',
    description: 'Creates the customer locally and mirrors it into the billing provider (Polar).',
    responses: {
      201: jsonResponse('Customer created', CustomerSchema),
      400: errorResponses[400],
      401: errorResponses[401],
      409: errorResponses[409],
      422: errorResponses[422],
      502: errorResponses[502],
    },
  }),
  validate('json', CreateCustomerBodySchema),
  async (c) => {
    const customer = await c.var.container.customers.create(c.req.valid('json'))
    return c.json(toCustomerResponse(customer), 201)
  },
)
