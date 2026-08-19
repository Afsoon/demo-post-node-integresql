import { Hono } from 'hono'
import type { AppEnv } from '../../shared/http/app-env.ts'
import { createCustomerRoute } from './use-cases/create-customer/route.ts'
import { deleteCustomerRoute } from './use-cases/delete-customer/route.ts'
import { getCustomerRoute } from './use-cases/get-customer/route.ts'
import { listCustomersRoute } from './use-cases/list-customers/route.ts'
import { updateCustomerRoute } from './use-cases/update-customer/route.ts'

export const customersRoutes = new Hono<AppEnv>()
  .route('/', listCustomersRoute)
  .route('/', createCustomerRoute)
  .route('/', getCustomerRoute)
  .route('/', updateCustomerRoute)
  .route('/', deleteCustomerRoute)
