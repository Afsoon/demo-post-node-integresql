import { Hono } from 'hono'
import type { AppEnv } from '../../shared/http/app-env.ts'
import { createBillingProfileRoute } from './use-cases/create-billing-profile/route.ts'
import { deleteBillingProfileRoute } from './use-cases/delete-billing-profile/route.ts'
import { getBillingProfileRoute } from './use-cases/get-billing-profile/route.ts'
import { updateBillingProfileRoute } from './use-cases/update-billing-profile/route.ts'

/** Mounted under /customers/:customerId/billing-profile */
export const billingRoutes = new Hono<AppEnv>()
  .route('/', createBillingProfileRoute)
  .route('/', getBillingProfileRoute)
  .route('/', updateBillingProfileRoute)
  .route('/', deleteBillingProfileRoute)
