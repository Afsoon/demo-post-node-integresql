import { Hono } from 'hono'
import type { AppEnv } from '../../../../shared/http/app-env.ts'
import { describeRoute, errorResponses, jsonResponse, validate } from '../../../../shared/http/openapi.ts'
import { CustomerUsageParamSchema, toPeriodResponse, toSummaryResponse } from '../../schemas.ts'
import { type CurrentUsage, CurrentUsageSchema } from './schema.ts'

export const getCurrentUsageRoute = new Hono<AppEnv>().get(
  '/current',
  describeRoute({
    tags: ['Usage'],
    summary: 'Current month usage of a customer',
    description: 'Aggregates over the current UTC calendar month, plus limit status when a billing profile exists.',
    responses: {
      200: jsonResponse('Current usage', CurrentUsageSchema),
      400: errorResponses[400],
      401: errorResponses[401],
      404: errorResponses[404],
    },
  }),
  validate('param', CustomerUsageParamSchema),
  async (c) => {
    const { customerId, period, summary, limit } = await c.var.container.usage.current(c.req.valid('param').customerId)
    const body: CurrentUsage = { customerId, period: toPeriodResponse(period), ...toSummaryResponse(summary), limit }
    return c.json(body, 200)
  },
)
