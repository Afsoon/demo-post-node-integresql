import { Hono } from 'hono'
import type { AppEnv } from '../../../../shared/http/app-env.ts'
import { describeRoute, errorResponses, jsonResponse, validate } from '../../../../shared/http/openapi.ts'
import { CustomerIdParamSchema } from '../../../../shared/http/schemas.ts'
import { BillingProfileSchema, toBillingProfileResponse } from '../../schemas.ts'
import { CreateBillingProfileBodySchema } from './schema.ts'

export const createBillingProfileRoute = new Hono<AppEnv>().post(
  '/',
  describeRoute({
    tags: ['Billing'],
    summary: 'Create the billing profile of a customer',
    description: 'Company information, usage limits and pricing used for billing. One profile per customer.',
    responses: {
      201: jsonResponse('Billing profile created', BillingProfileSchema),
      400: errorResponses[400],
      401: errorResponses[401],
      404: errorResponses[404],
      409: errorResponses[409],
      422: errorResponses[422],
    },
  }),
  validate('param', CustomerIdParamSchema),
  validate('json', CreateBillingProfileBodySchema),
  async (c) => {
    const profile = await c.var.container.billing.create(c.req.valid('param').customerId, c.req.valid('json'))
    return c.json(toBillingProfileResponse(profile), 201)
  },
)
