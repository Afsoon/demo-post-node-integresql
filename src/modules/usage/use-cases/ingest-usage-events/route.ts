import { Hono } from 'hono'
import type { AppEnv } from '../../../../shared/http/app-env.ts'
import { describeRoute, errorResponses, jsonResponse, validate } from '../../../../shared/http/openapi.ts'
import { IngestUsageEventsBodySchema, IngestUsageEventsResultSchema } from './schema.ts'

export const ingestUsageEventsRoute = new Hono<AppEnv>().post(
  '/',
  describeRoute({
    tags: ['Webhooks'],
    summary: 'Ingest usage events',
    description:
      'Accepts a batch of 1..1000 events. Items are validated independently: valid ones are stored in the ' +
      'usage_events hypertable (idempotent on eventId), invalid ones are reported ' +
      'in `rejected`. The response is 200 even when some items are rejected. Requires an `x-idempotency-id` header: ' +
      'the same key + body within 72h replays the stored response (Idempotent-Replayed: true), a different body → 422.',
    parameters: [
      {
        in: 'header',
        name: 'x-idempotency-id',
        required: true,
        schema: { type: 'string', minLength: 1, maxLength: 200 },
        description: 'Idempotency key chosen by the producer, valid 72h',
      },
    ],
    responses: {
      200: jsonResponse('Batch outcome', IngestUsageEventsResultSchema),
      400: errorResponses[400],
      401: errorResponses[401],
      409: { ...errorResponses[409], description: 'Same idempotency key still being processed' },
      422: { ...errorResponses[422], description: 'Idempotency key reused with a different body' },
    },
  }),
  validate('json', IngestUsageEventsBodySchema),
  async (c) => {
    const result = await c.var.container.usage.ingest(c.req.valid('json'))
    return c.json(result, 200)
  },
)
