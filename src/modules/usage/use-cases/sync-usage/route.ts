import { Hono } from 'hono'
import type { AppEnv } from '../../../../shared/http/app-env.ts'
import { describeRoute, errorResponses, jsonResponse, validate } from '../../../../shared/http/openapi.ts'
import { CustomerUsageParamSchema, UsageSettlementSchema, toSettlementResponse } from '../../schemas.ts'
import { SyncUsageBodySchema } from './schema.ts'

export const syncUsageRoute = new Hono<AppEnv>().post(
  '/sync',
  describeRoute({
    tags: ['Usage'],
    summary: 'Sync usage of a period to Polar and charge it',
    description:
      'Forwards unsynced events of the period to Polar (events.ingest, external_id = eventId), then creates and ' +
      'finalizes an off-session order for syncedQuantity × pricePerUnitCents (none for the free plan or zero amount). ' +
      'Safe to retry: already synced events are skipped. Customer must be linked to Polar.',
    responses: {
      200: jsonResponse('Settlement', UsageSettlementSchema),
      400: errorResponses[400],
      401: errorResponses[401],
      404: errorResponses[404],
      422: errorResponses[422],
      502: errorResponses[502],
    },
  }),
  validate('param', CustomerUsageParamSchema),
  validate('json', SyncUsageBodySchema),
  async (c) => {
    const { start, end } = c.req.valid('json')
    const settlement = await c.var.container.usage.sync(c.req.valid('param').customerId, {
      start: new Date(start),
      end: new Date(end),
    })
    return c.json(toSettlementResponse(settlement), 200)
  },
)
