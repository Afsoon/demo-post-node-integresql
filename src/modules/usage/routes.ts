import { Hono } from 'hono'
import type { AppEnv } from '../../shared/http/app-env.ts'
import { getCurrentUsageRoute } from './use-cases/get-current-usage/route.ts'
import { getUsageReportRoute } from './use-cases/get-usage-report/route.ts'
import { ingestUsageEventsRoute } from './use-cases/ingest-usage-events/route.ts'
import { syncUsageRoute } from './use-cases/sync-usage/route.ts'

/** Mounted under /webhooks/usage-events */
export const usageWebhookRoutes = new Hono<AppEnv>().route('/', ingestUsageEventsRoute)

/** Mounted under /customers/:customerId/usage */
export const customerUsageRoutes = new Hono<AppEnv>()
  .route('/', getCurrentUsageRoute)
  .route('/', syncUsageRoute)
  .route('/', getUsageReportRoute)
