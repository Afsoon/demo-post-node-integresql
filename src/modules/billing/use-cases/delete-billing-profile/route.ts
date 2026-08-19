import { Hono } from 'hono'
import type { AppEnv } from '../../../../shared/http/app-env.ts'
import { describeRoute, errorResponses, noContent, validate } from '../../../../shared/http/openapi.ts'
import { CustomerIdParamSchema } from '../../../../shared/http/schemas.ts'

export const deleteBillingProfileRoute = new Hono<AppEnv>().delete(
  '/',
  describeRoute({
    tags: ['Billing'],
    summary: 'Delete the billing profile of a customer',
    responses: {
      204: noContent,
      400: errorResponses[400],
      401: errorResponses[401],
      404: errorResponses[404],
    },
  }),
  validate('param', CustomerIdParamSchema),
  async (c) => {
    await c.var.container.billing.delete(c.req.valid('param').customerId)
    return c.body(null, 204)
  },
)
