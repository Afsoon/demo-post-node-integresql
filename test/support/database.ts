import { IntegreSQLClient } from "@devoxa/integresql-client";
import { inject } from "vitest";
import { createDb } from "../../src/infra/db/client.ts";
import { pgConnectionUrl } from "./pg-url.ts";

/**
 * Leases an isolated database cloned from the migrated template.
 * Call `release()` when done: it closes the pool and asks integresql to recreate the clone.
 */
export async function createTestDatabase() {
  const ctx = inject("integresql");
  const client = new IntegreSQLClient({ url: ctx.url });

  const { id, database } = await client.api.getTestDatabase(ctx.templateHash);

  // integresql reports its own view of the connection (socket dir); from the worker we either reach
  // Postgres over the mapped TCP port, or — on Linux with TEST_PG_SOCKET_DIR — over the same socket.
  const url = pgConnectionUrl(
    database.config,
    ctx.socketDir ? { socketDir: ctx.socketDir } : { host: ctx.host, port: ctx.port },
  );
  // Every connection to a fresh clone is a cold backend (TimescaleDB catalog warm-up ≈ 15–60 ms):
  // keep the pool small. Sequential specs use 1, fan-outs still get parallelism.
  const { db, pool } = createDb(url, { max: Number(process.env.TEST_PG_POOL_MAX ?? 4) });

  return {
    db,
    pool,
    url,
    async release() {
      await pool.end();
      await client.api.recreateTestDatabase(ctx.templateHash, id);
    },
  };
}

export type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
