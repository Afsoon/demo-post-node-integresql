import { Hono } from 'hono'
import type { AppEnv } from '../../../../shared/http/app-env.ts'
import { describeRoute, errorResponses, jsonResponse, validate } from '../../../../shared/http/openapi.ts'
import { CustomerUsageParamSchema, toPeriodResponse, toSummaryResponse } from '../../schemas.ts'
import { type UsageReport, UsageReportQuerySchema, UsageReportSchema } from './schema.ts'

export const getUsageReportRoute = new Hono<AppEnv>().get(
  '/',
  describeRoute({
    tags: ['Usage'],
    summary: 'Usage of a customer between two dates',
    description: 'Totals plus a time_bucket series (hour|day|week|month, default day). Max range 366 days.',
    responses: {
      200: jsonResponse('Usage report', UsageReportSchema),
      400: errorResponses[400],
      401: errorResponses[401],
      404: errorResponses[404],
    },
  }),
  validate('param', CustomerUsageParamSchema),
  validate('query', UsageReportQuerySchema),
  async (c) => {
    const report = await c.var.container.usage.report(c.req.valid('param').customerId, c.req.valid('query'))
    const body: UsageReport = {
      customerId: report.customerId,
      period: toPeriodResponse(report.period),
      bucket: report.bucket,
      totals: toSummaryResponse(report.totals),
      series: report.series.map((row) => ({ ...row, bucketStart: row.bucketStart.toISOString() })),
    }
    return c.json(body, 200)
  },
)
