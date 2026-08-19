import type { Env } from './config/env.ts'
import { createDb } from './infra/db/client.ts'
import { createDrizzleIdempotencyStore } from './infra/idempotency/drizzle-idempotency-store.ts'
import { createPolarClient } from './infra/polar/client.ts'
import { createBillingModule } from './modules/billing/index.ts'
import type { BillingProviderCustomers } from './modules/customers/domain/billing-provider.ts'
import { createCustomersModule } from './modules/customers/index.ts'
import {
  createNoopBillingProviderCustomers,
  createPolarCustomersClient,
} from './modules/customers/infra/polar-customers-client.ts'
import type { BillingProviderUsage } from './modules/usage/domain/billing-provider-usage.ts'
import { createUsageModule } from './modules/usage/index.ts'
import { createNoopBillingProviderUsage, createPolarUsageClient } from './modules/usage/infra/polar-usage-client.ts'

export type ContainerDeps = {
  db: ReturnType<typeof createDb>['db']
  billingProvider: { customers: BillingProviderCustomers; usage: BillingProviderUsage }
}

/**
 * Composition root. Everything that talks to the outside world (db, Polar) is passed in,
 * so tests can swap the db for an integresql clone and let MSW intercept Polar's HTTP calls.
 */
export function createContainer({ db, billingProvider }: ContainerDeps) {
  // customers.delete settles usage through the usage module, which itself needs the customer
  // repository: the closure is resolved at call time, after both modules exist.
  const customers = createCustomersModule({
    db,
    billingProvider: billingProvider.customers,
    settleUsage: (customerId, period) => usage.sync(customerId, period),
  })
  const billing = createBillingModule({ db, customers: customers.repository })
  const usage = createUsageModule({
    db,
    customers: customers.repository,
    billingProfiles: billing.repository,
    billingProvider: billingProvider.usage,
  })
  const idempotencyStore = createDrizzleIdempotencyStore(db)
  return { customers, billing, usage, idempotencyStore }
}

export type Container = ReturnType<typeof createContainer>

/**
 * Billing provider from environment: real Polar SDK adapters when a token is configured,
 * no-op adapters otherwise. Tests use the same path (MSW intercepts the SDK's HTTP calls).
 */
export function createBillingProviderFromEnv(env: Env) {
  if (!env.POLAR_ACCESS_TOKEN || !env.POLAR_PRODUCT_ID) {
    console.warn('POLAR_ACCESS_TOKEN not set: billing provider (customers + usage) is a no-op')
    const provider: ContainerDeps['billingProvider'] = {
      customers: createNoopBillingProviderCustomers(),
      usage: createNoopBillingProviderUsage(),
    }
    return provider
  }
  const polar = createPolarClient({ accessToken: env.POLAR_ACCESS_TOKEN, environment: env.POLAR_ENVIRONMENT })
  const provider: ContainerDeps['billingProvider'] = {
    customers: createPolarCustomersClient(polar),
    usage: createPolarUsageClient(polar, { productId: env.POLAR_PRODUCT_ID }),
  }
  return provider
}

/** Production wiring from environment variables. */
export function createContainerFromEnv(env: Env) {
  const { db, pool } = createDb(env.DATABASE_URL)
  const container = createContainer({ db, billingProvider: createBillingProviderFromEnv(env) })
  return { container, pool }
}
