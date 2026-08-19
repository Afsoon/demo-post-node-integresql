import { Hono } from 'hono'
import type { AppEnv } from '../../../../shared/http/app-env.ts'
import { describeRoute, errorResponses, jsonResponse, validate } from '../../../../shared/http/openapi.ts'
import { CustomerIdParamSchema } from '../../../../shared/http/schemas.ts'
import { BillingProfileSchema, toBillingProfileResponse } from '../../schemas.ts'

export const getBillingProfileRoute = new Hono<AppEnv>().get(
  '/',
  describeRoute({
    tags: ['Billing'],
    summary: 'Get the billing profile of a customer',
    responses: {
      200: jsonResponse('Billing profile', BillingProfileSchema),
      400: errorResponses[400],
      401: errorResponses[401],
      404: errorResponses[404],
    },
  }),
  validate('param', CustomerIdParamSchema),
  async (c) => {
    const profile = await c.var.container.billing.get(c.req.valid('param').customerId)
    return c.json(toBillingProfileResponse(profile), 200)
  },
)
