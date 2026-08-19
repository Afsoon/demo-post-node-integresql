import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString })
  // Column names are snake_cased per table via `snakeCase.table` in ./schema
  const db = drizzle({ client: pool })
  return { pool, db }
}

export type Db = ReturnType<typeof createDb>['db']
