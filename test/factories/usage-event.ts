import type { UsageEventBody } from './types.ts'

let counter = 0

/** Unique eventId per call; override it to provoke duplicates on purpose. */
export function usageEventBody(customerId: string, overrides: Partial<UsageEventBody> = {}) {
  counter += 1
  const body: UsageEventBody = { customerId, eventName: 'api_call', eventId: `evt-${counter}`, ...overrides }
  return body
}

export function usageBatch(customerId: string, size: number, overrides: Partial<UsageEventBody> = {}) {
  return Array.from({ length: size }, () => usageEventBody(customerId, overrides))
}

export const idempotencyKey = () => `key-${crypto.randomUUID()}`

/** Events with `occurredAt` spread evenly over the last `days` days (oldest first), never in the future. */
export function usageBatchSpread(
  customerId: string,
  size: number,
  { days, now = new Date(), ...overrides }: Partial<UsageEventBody> & { days: number; now?: Date },
) {
  const span = days * 86_400_000
  return Array.from({ length: size }, (_, i) => {
    const occurredAt = new Date(now.getTime() - span + Math.floor((i / size) * span) + 1).toISOString()
    return usageEventBody(customerId, { occurredAt, ...overrides })
  })
}
