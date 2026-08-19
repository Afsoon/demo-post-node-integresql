import { Scalar } from '@scalar/hono-api-reference'
import { Hono } from 'hono'
import { openAPIRouteHandler } from 'hono-openapi'
import { logger } from 'hono/logger'
import type { Container } from './container.ts'
import { billingRoutes } from './modules/billing/routes.ts'
import { customersRoutes } from './modules/customers/routes.ts'
import { customerUsageRoutes, usageWebhookRoutes } from './modules/usage/routes.ts'
import type { AppEnv } from './shared/http/app-env.ts'
import { createBearerAuth } from './shared/http/auth.ts'
import { errorHandler } from './shared/http/error-handler.ts'
import { idempotency } from './shared/http/idempotency.ts'

export type AppOptions = {
  apiToken: string
  /** Request logging (default true); tests turn it off. */
  logger?: boolean
}

const passthrough = (): ReturnType<typeof logger> => async (_c, next) => next()

/**
 * One chained Hono instance so the route schema is carried in the type:
 * `hono/client` / `hono/testing` get a fully typed RPC client from `App`.
 */
export function createApp(container: Container, { apiToken, logger: withLogger = true }: AppOptions) {
  const auth = createBearerAuth(apiToken)

  const app = new Hono<AppEnv>()
    .use(withLogger ? logger() : passthrough())
    .use(async (c, next) => {
      c.set('container', container)
      await next()
    })
    .onError(errorHandler)
    // Public
    .get('/health', (c) => c.json({ status: 'ok' }, 200))
    // Protected: every API route requires `Authorization: Bearer <API_TOKEN>`
    .use('/customers', auth)
    .use('/customers/*', auth)
    .use('/webhooks/*', auth)
    .route('/customers', customersRoutes)
    .route('/customers/:customerId/billing-profile', billingRoutes)
    .route('/customers/:customerId/usage', customerUsageRoutes)
    .use('/webhooks/usage-events', idempotency({ store: container.idempotencyStore }))
    .route('/webhooks/usage-events', usageWebhookRoutes)

  // OpenAPI + docs are generated from the same instance (chaining returns `app` itself)
  return app
    .get(
      '/openapi',
      openAPIRouteHandler(app, {
        documentation: {
          info: {
            title: 'Metered usage API',
            version: '0.1.0',
            description: 'Customers, billing profiles and usage events stored in TimescaleDB, billed through Polar.',
          },
          tags: [
            { name: 'Customers', description: 'Customer identity, mirrored into Polar.' },
            { name: 'Billing', description: 'Company info, limits and pricing per customer.' },
            { name: 'Usage', description: 'Aggregated usage read from the usage_events hypertable, Polar sync.' },
            { name: 'Webhooks', description: 'Inbound batch ingestion of usage events.' },
          ],
          components: {
            securitySchemes: {
              bearerAuth: { type: 'http', scheme: 'bearer', description: 'API_TOKEN from the environment' },
            },
          },
          security: [{ bearerAuth: [] }],
        },
      }),
    )
    .get('/docs', Scalar({ url: '/openapi', pageTitle: 'Metered usage API' }))
}

export type App = ReturnType<typeof createApp>
