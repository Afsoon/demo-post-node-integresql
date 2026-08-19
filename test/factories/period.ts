import type { SyncPeriodBody, UsageReportQuery } from './types.ts'

/** Wide period covering every event ingested "now" during a test run. */
export const thisYear: SyncPeriodBody = { start: '2026-01-01T00:00:00Z', end: '2026-12-31T00:00:00Z' }

export const isoDaysAgo = (days: number, now = new Date()) => new Date(now.getTime() - days * 86_400_000).toISOString()

/** First day of the previous UTC month at noon: always outside "current month", never in the future. */
export function lastMonthDate(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 12)).toISOString()
}

export function reportQuery(overrides: Partial<UsageReportQuery> = {}) {
  const query: UsageReportQuery = { start: thisYear.start, end: thisYear.end, ...overrides }
  return query
}

export const isoMinutesFromNow = (minutes: number, now = new Date()) =>
  new Date(now.getTime() + minutes * 60_000).toISOString()

/** First instant of the current UTC month. */
export const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()

/** Last millisecond of the previous UTC month. */
export const lastMonthEnd = (now = new Date()) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1).toISOString()
