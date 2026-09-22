import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

export type DbOptions = {
  /** Max pooled connections (pg default 10). Tests use a small number: every connection to a fresh clone is a cold backend. */
  max?: number;
};

/** Accepts TCP or Unix socket URLs/configs; a socket `host` is an absolute directory path. */
export function createDb(connection: string | PoolConfig, { max }: DbOptions = {}) {
  const config = typeof connection === "string" ? { connectionString: connection } : connection;
  const pool = new Pool({ ...config, ...(max === undefined ? {} : { max }) });
  // Column names are snake_cased per table via `snakeCase.table` in ./schema
  const db = drizzle({ client: pool });
  return { pool, db };
}

export type Db = ReturnType<typeof createDb>["db"];
