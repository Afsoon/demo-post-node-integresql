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

export type AppOptions = { apiToken: string }

export function createApp(container: Container, { apiToken }: AppOptions) {
  const app = new Hono<AppEnv>()

  app.use(logger())
  app.use(async (c, next) => {
    c.set('container', container)
    await next()
  })
  app.onError(errorHandler)

  // Public
  app.get('/health', (c) => c.json({ status: 'ok' }))

  // Protected: every API route requires `Authorization: Bearer <API_TOKEN>`
  const auth = createBearerAuth(apiToken)
  app.use('/customers', auth)
  app.use('/customers/*', auth)
  app.use('/webhooks/*', auth)

  app.route('/customers', customersRoutes)
  app.route('/customers/:customerId/billing-profile', billingRoutes)
  app.route('/customers/:customerId/usage', customerUsageRoutes)
  app.use('/webhooks/usage-events', idempotency({ store: container.idempotencyStore }))
  app.route('/webhooks/usage-events', usageWebhookRoutes)

  app.get(
    '/openapi',
    openAPIRouteHandler(app, {
      documentation: {
        info: {
          title: 'Metered usage API',
          version: '0.1.0',
          description: 'Customers, billing profiles and (soon) usage events stored in TimescaleDB.',
        },
        tags: [
          { name: 'Customers', description: 'Customer identity, mirrored into Polar.' },
          { name: 'Billing', description: 'Company info, limits and pricing per customer.' },
          { name: 'Usage', description: 'Aggregated usage read from the usage_events hypertable.' },
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
  app.get('/docs', Scalar({ url: '/openapi', pageTitle: 'Metered usage API' }))

  return app
}

export type App = ReturnType<typeof createApp>
