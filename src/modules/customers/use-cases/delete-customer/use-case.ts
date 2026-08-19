import { NotFoundError } from '../../../../shared/errors.ts'
import type { BillingProviderCustomers } from '../../domain/billing-provider.ts'
import type { CustomerRepository } from '../../domain/customer-repository.ts'
import { type SettleUsage, type SettlementResult, currentMonthPeriod } from '../../domain/usage-settlement.ts'

type Deps = { customers: CustomerRepository; billingProvider: BillingProviderCustomers; settleUsage: SettleUsage }

/**
 * Deleting a customer first settles the current month: unsynced usage is forwarded to Polar and
 * charged, so nothing billable is lost. Then the Polar mirror and the local row (+ billing profile,
 * cascade) are removed. Usage events stay in the hypertable (no FK) for reporting/audit.
 */
export function createDeleteCustomer({ customers, billingProvider, settleUsage }: Deps) {
  return async (id: string, now = new Date()) => {
    const customer = await customers.findById(id)
    if (!customer) throw new NotFoundError('customer', id)

    // Only linked customers can be settled; unlinked ones have nothing on the provider side.
    const settlement: SettlementResult | null = customer.polarCustomerId
      ? await settleUsage(id, currentMonthPeriod(now))
      : null

    // Provider first: if Polar rejects, our row stays and the call can be retried.
    if (customer.polarCustomerId) await billingProvider.delete(customer.polarCustomerId)
    // A concurrent delete may have won the race: only the caller that removed the row reports success.
    if (!(await customers.delete(id))) throw new NotFoundError('customer', id)

    return { customerId: id, settlement }
  }
}
