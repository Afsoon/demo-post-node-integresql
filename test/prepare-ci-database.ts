import { createDb } from "../src/infra/db/client.ts";
import { runMigrations } from "../src/infra/db/migrate.ts";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL must point directly to the test TimescaleDB template");

// Run before starting pgtest so every clone includes the migrated schema.
const { db, pool } = createDb(url);
try {
  await runMigrations(db);
} finally {
  await pool.end();
}
