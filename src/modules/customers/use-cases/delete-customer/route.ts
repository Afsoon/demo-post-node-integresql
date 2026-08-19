import { Hono } from 'hono'
import type { AppEnv } from '../../../../shared/http/app-env.ts'
import { describeRoute, errorResponses, jsonResponse, validate } from '../../../../shared/http/openapi.ts'
import { IdParamSchema } from '../../../../shared/http/schemas.ts'
import { DeleteCustomerResultSchema, toSettlementResultResponse } from './schema.ts'

export const deleteCustomerRoute = new Hono<AppEnv>().delete(
  '/:id',
  describeRoute({
    tags: ['Customers'],
    summary: 'Delete a customer',
    description:
      'Settles the current month first (unsynced usage is forwarded to Polar and charged), then deletes the ' +
      'mirrored Polar customer, the customer and its billing profile (cascade). Usage events are kept.',
    responses: {
      200: jsonResponse('Customer deleted', DeleteCustomerResultSchema),
      400: errorResponses[400],
      401: errorResponses[401],
      404: errorResponses[404],
      502: errorResponses[502],
    },
  }),
  validate('param', IdParamSchema),
  async (c) => {
    const { customerId, settlement } = await c.var.container.customers.delete(c.req.valid('param').id)
    return c.json({ customerId, settlement: settlement ? toSettlementResultResponse(settlement) : null }, 200)
  },
)
