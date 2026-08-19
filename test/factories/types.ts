import type { TestApi } from '../support/api.ts'

/** Request payload types derived from the typed RPC client, so factories follow the API contract. */
type Client = TestApi['client']

export type CustomerBody = Parameters<Client['customers']['$post']>[0]['json']
export type CustomerPatch = Parameters<Client['customers'][':id']['$patch']>[0]['json']
export type BillingProfileBody = Parameters<Client['customers'][':customerId']['billing-profile']['$post']>[0]['json']
export type BillingProfilePatch = Parameters<Client['customers'][':customerId']['billing-profile']['$patch']>[0]['json']
export type UsageEventBody = Parameters<Client['webhooks']['usage-events']['$post']>[0]['json'][number]
export type SyncPeriodBody = Parameters<Client['customers'][':customerId']['usage']['sync']['$post']>[0]['json']
export type UsageReportQuery = Parameters<Client['customers'][':customerId']['usage']['$get']>[0]['query']
