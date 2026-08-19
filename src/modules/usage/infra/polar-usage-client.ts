import { PolarClientError, PolarError } from '@polar-sh/sdk'
import type { models } from '@polar-sh/sdk/2026-04'
import type { PolarClient } from '../../../infra/polar/client.ts'
import { BillingProviderError } from '../../../shared/errors.ts'
import type { BillingProviderUsage } from '../domain/billing-provider-usage.ts'

const INGEST_CHUNK = 500

function wrap(error: unknown, operation: string) {
  if (error instanceof PolarClientError) {
    return new BillingProviderError(`Polar ${operation} failed with status ${error.statusCode}`, error.error)
  }
  if (error instanceof PolarError) return new BillingProviderError(`Polar ${operation} failed: ${error.message}`)
  return error
}

export type PolarUsageClientOptions = {
  /** One-time Polar product used as the line item of off-session usage orders. */
  productId: string
}

/** Adapter: forwards usage events to Polar meters and charges usage through off-session orders. */
export function createPolarUsageClient(polar: PolarClient, { productId }: PolarUsageClientOptions) {
  const client: BillingProviderUsage = {
    async ingestEvents(events) {
      let inserted = 0
      let duplicates = 0
      for (let i = 0; i < events.length; i += INGEST_CHUNK) {
        const chunk = events.slice(i, i + INGEST_CHUNK)
        try {
          const result = await polar.events.ingest({
            events: chunk.map((event) => ({
              name: event.eventName,
              external_customer_id: event.externalCustomerId,
              external_id: event.eventId,
              timestamp: event.occurredAt.toISOString(),
              // The SDK types only the reserved `_cost`/`_llm` keys; Polar accepts arbitrary scalar metadata.
              metadata: { ...event.metadata, quantity: event.quantity } as models.EventMetadataInput,
            })),
          })
          inserted += result.inserted
          duplicates += result.duplicates ?? 0
        } catch (error) {
          throw wrap(error, 'events.ingest')
        }
      }
      return { inserted, duplicates }
    },

    async chargeUsage(input) {
      try {
        const draft = await polar.orders.create({
          customer_id: input.providerCustomerId,
          product_id: productId,
          amount: input.amountCents,
          currency: input.currency.toLowerCase(),
          description: input.description,
          metadata: input.metadata,
        })
        const order = await polar.orders.finalize(draft.id, {})
        return { orderId: order.id, status: order.status }
      } catch (error) {
        throw wrap(error, 'orders.create/finalize')
      }
    },
  }
  return client
}

/** Used when no POLAR_ACCESS_TOKEN is configured: keeps the service runnable offline. */
export function createNoopBillingProviderUsage() {
  const client: BillingProviderUsage = {
    async ingestEvents(events) {
      return { inserted: events.length, duplicates: 0 }
    },
    async chargeUsage() {
      return { orderId: `noop_order_${crypto.randomUUID()}`, status: 'paid' }
    },
  }
  return client
}
