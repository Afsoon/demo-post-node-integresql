import { asc, eq, gt, inArray } from 'drizzle-orm'
import type { Db } from '../../../infra/db/client.ts'
import { customers } from '../../../infra/db/schema/index.ts'
import { ConflictError } from '../../../shared/errors.ts'
import { isUniqueViolation } from '../../../shared/pg-errors.ts'
import type { Customer, NewCustomer } from '../domain/customer.ts'
import type { CustomerRepository } from '../domain/customer-repository.ts'

type Row = typeof customers.$inferSelect

function toCustomer(row: Row) {
  const customer: Customer = {
    id: row.id,
    email: row.email,
    name: row.name,
    type: row.type,
    status: row.status,
    polarCustomerId: row.polarCustomerId,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
  return customer
}

function asRepositoryError(error: unknown, email: string) {
  if (isUniqueViolation(error)) return new ConflictError(`customer with email ${email} already exists`, { email })
  return error
}

export function createDrizzleCustomerRepository(db: Db) {
  const repository: CustomerRepository = {
    async findById(id) {
      const [row] = await db.select().from(customers).where(eq(customers.id, id)).limit(1)
      return row ? toCustomer(row) : null
    },

    async findByIds(ids) {
      if (ids.length === 0) return []
      const rows = await db.select().from(customers).where(inArray(customers.id, ids))
      return rows.map(toCustomer)
    },

    async findByEmail(email) {
      const [row] = await db.select().from(customers).where(eq(customers.email, email)).limit(1)
      return row ? toCustomer(row) : null
    },

    async list({ limit, cursor }) {
      // ids are uuidv7 → time ordered, so keyset pagination on id is stable
      const rows = await db
        .select()
        .from(customers)
        .where(cursor ? gt(customers.id, cursor) : undefined)
        .orderBy(asc(customers.id))
        .limit(limit + 1)
      const page = rows.slice(0, limit)
      return {
        items: page.map(toCustomer),
        nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
      }
    },

    async insert(customer: NewCustomer) {
      try {
        const [row] = await db.insert(customers).values(customer).returning()
        return toCustomer(row!)
      } catch (error) {
        throw asRepositoryError(error, customer.email)
      }
    },

    async save(customer) {
      try {
        const [row] = await db
          .update(customers)
          .set({
            email: customer.email,
            name: customer.name,
            status: customer.status,
            polarCustomerId: customer.polarCustomerId,
            metadata: customer.metadata,
            updatedAt: customer.updatedAt,
          })
          .where(eq(customers.id, customer.id))
          .returning()
        return toCustomer(row!)
      } catch (error) {
        throw asRepositoryError(error, customer.email)
      }
    },

    async delete(id) {
      const deleted = await db.delete(customers).where(eq(customers.id, id)).returning({ id: customers.id })
      return deleted.length > 0
    },
  }
  return repository
}
