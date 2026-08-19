import { PolarClientError, PolarError } from '@polar-sh/sdk'
import type { PolarClient } from '../../../infra/polar/client.ts'
import { BillingProviderError } from '../../../shared/errors.ts'
import type { BillingProviderCustomers } from '../domain/billing-provider.ts'

function wrap(error: unknown, operation: string) {
  if (error instanceof PolarClientError) {
    return new BillingProviderError(`Polar ${operation} failed with status ${error.statusCode}`, error.error)
  }
  if (error instanceof PolarError) {
    return new BillingProviderError(`Polar ${operation} failed: ${error.message}`)
  }
  return error
}

/** Adapter: mirrors our customers into Polar via the official SDK. */
export function createPolarCustomersClient(polar: PolarClient) {
  const client: BillingProviderCustomers = {
    async create(input) {
      try {
        const created = await polar.customers.create(
          input.type === 'team'
            ? { type: 'team', external_id: input.externalId, email: input.email, name: input.name, metadata: input.metadata }
            : { type: 'individual', external_id: input.externalId, email: input.email, name: input.name, metadata: input.metadata },
        )
        return { providerCustomerId: created.id }
      } catch (error) {
        throw wrap(error, 'customers.create')
      }
    },

    async update(providerCustomerId, patch) {
      try {
        await polar.customers.update(providerCustomerId, {
          ...(patch.email !== undefined && { email: patch.email }),
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.metadata !== undefined && { metadata: patch.metadata }),
        })
      } catch (error) {
        throw wrap(error, 'customers.update')
      }
    },

    async delete(providerCustomerId) {
      try {
        await polar.customers.delete(providerCustomerId)
      } catch (error) {
        if (error instanceof PolarClientError && error.statusCode === 404) return
        throw wrap(error, 'customers.delete')
      }
    },
  }
  return client
}

/** Used when no POLAR_ACCESS_TOKEN is configured: keeps the service runnable offline. */
export function createNoopBillingProviderCustomers() {
  const client: BillingProviderCustomers = {
    async create() {
      return { providerCustomerId: `noop_${crypto.randomUUID()}` }
    },
    async update() {},
    async delete() {},
  }
  return client
}
