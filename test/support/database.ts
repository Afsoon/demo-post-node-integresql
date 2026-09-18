import { inject } from "vitest";
import { createDb } from "../../src/infra/db/client.ts";
import { randomUUIDv7 } from "node:crypto";
import { sql } from "drizzle-orm";

let globalTestDatabase: (ReturnType<typeof createDb> & { url: string }) | undefined;

/** Shared pgtest Unix socket connection for this worker; test/setup.ts owns its cleanup. */
export function getGlobalTestDatabase() {
  if (!globalTestDatabase) {
    const host = process.env.PGTEST_SOCKET_DIR ?? "/tmp/pgtest";
    if (!host.startsWith("/")) {
      throw new Error("PGTEST_SOCKET_DIR must be an absolute Unix socket directory");
    }
    const port = process.env.PGTEST_SOCKET_PORT ?? "6432";
    const url = `postgres://metered:metered@/pgtest?${new URLSearchParams({ host, port })}`;
    globalTestDatabase = {
      ...createDb(
        { host, port: Number(port), user: "metered", password: "metered", database: "pgtest" },
        { max: 1 },
      ),
      url,
    };
  }
  return globalTestDatabase;
}

export async function releaseGlobalTestDatabase() {
  const database = globalTestDatabase;
  globalTestDatabase = undefined;
  await database?.pool.end();
}

/**
 * Connects to an isolated database through pgtest. Release closes every pooled connection.
 */
export async function createTestDatabase() {
  const ctx = inject("pgtest");

  let idTest = randomUUIDv7();
  const url = `postgres://metered:metered@${ctx.host}:6432/metered/${idTest}`;
  // Workers × concurrent tests × pool size all contribute sockets to the shared pgtest process.
  const max = Number(process.env.TEST_PG_POOL_MAX ?? "2");
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new Error("TEST_PG_POOL_MAX must be a positive integer");
  }
  const { db, pool } = createDb(url, { max });

  return {
    db,
    pool,
    url,
    async release() {
      try {
        await pool.end();
      } finally {
        const control = getGlobalTestDatabase();
        await control.db.execute(sql`SELECT pgtest_release(${idTest}::text)`);
      }
    },
  };
}

export type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
