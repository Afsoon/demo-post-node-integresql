import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

export type DbOptions = {
  /** Max pooled connections (pg default 10). Tests use a small number: every connection to a fresh clone is a cold backend. */
  max?: number
}

export function createDb(connectionString: string, { max }: DbOptions = {}) {
  const pool = new Pool({ connectionString, max })
  // Column names are snake_cased per table via `snakeCase.table` in ./schema
  const db = drizzle({ client: pool })
  return { pool, db }
}

export type Db = ReturnType<typeof createDb>['db']
