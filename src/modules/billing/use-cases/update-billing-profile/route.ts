import { Hono } from 'hono'
import type { AppEnv } from '../../../../shared/http/app-env.ts'
import { describeRoute, errorResponses, jsonResponse, validate } from '../../../../shared/http/openapi.ts'
import { CustomerIdParamSchema } from '../../../../shared/http/schemas.ts'
import { BillingProfileSchema, toBillingProfileResponse } from '../../schemas.ts'
import { UpdateBillingProfileBodySchema } from './schema.ts'

export const updateBillingProfileRoute = new Hono<AppEnv>().patch(
  '/',
  describeRoute({
    tags: ['Billing'],
    summary: 'Update the billing profile of a customer',
    description: 'Partial update; each section (company, limits, pricing) is merged with the stored values.',
    responses: {
      200: jsonResponse('Updated billing profile', BillingProfileSchema),
      400: errorResponses[400],
      401: errorResponses[401],
      404: errorResponses[404],
      422: errorResponses[422],
    },
  }),
  validate('param', CustomerIdParamSchema),
  validate('json', UpdateBillingProfileBodySchema),
  async (c) => {
    const profile = await c.var.container.billing.update(c.req.valid('param').customerId, c.req.valid('json'))
    return c.json(toBillingProfileResponse(profile), 200)
  },
)
