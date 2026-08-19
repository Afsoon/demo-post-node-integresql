import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import type { Db } from './client.ts'

const migrationsFolder = fileURLToPath(new URL('../../../drizzle', import.meta.url))

/** Applies every pending migration from ./drizzle. Reused by the test template setup later. */
export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder })
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const { loadEnv } = await import('../../config/env.ts')
  const { createDb } = await import('./client.ts')
  const env = loadEnv()
  const { db, pool } = createDb(env.DATABASE_URL)
  try {
    await runMigrations(db)
    console.log('migrations applied')
  } finally {
    await pool.end()
  }
}
