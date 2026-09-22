import { inject } from "vitest";
import { createDb } from "../../src/infra/db/client.ts";
import { randomUUIDv7 } from "node:crypto";
import { sql } from "drizzle-orm";

let globalTestDatabase: (ReturnType<typeof createDb> & { url: string }) | undefined;

/** Both test clients use the same endpoint, credentials, and connection options. */
function getPgtestUrl() {
  if (process.env.PGTEST_DATABASE_URL) {
    const url = new URL(process.env.PGTEST_DATABASE_URL);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      throw new Error("PGTEST_DATABASE_URL must use postgres:// or postgresql://");
    }
    return url;
  }

  // Preserve existing socket settings; otherwise use the injected TCP host.
  const socketDir = process.env.PGTEST_SOCKET_DIR;
  if (socketDir && !socketDir.startsWith("/")) {
    throw new Error("PGTEST_SOCKET_DIR must be an absolute Unix socket directory");
  }
  const url = new URL("postgres://metered:metered@localhost:6432/metered");
  if (socketDir) {
    url.searchParams.set("host", socketDir);
    url.port = process.env.PGTEST_SOCKET_PORT || "6432";
  } else {
    const { host, port } = inject("pgtest");
    url.searchParams.set("host", host);
    url.port = String(port);
  }
  return url;
}

/** Shared pgtest connection for this worker; test/setup.ts owns its cleanup. */
export function getGlobalTestDatabase() {
  if (!globalTestDatabase) {
    const connection = getPgtestUrl();
    connection.pathname = "/pgtest";
    const url = connection.toString();
    globalTestDatabase = { ...createDb(url, { max: 1 }), url };
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
  const idTest = randomUUIDv7();
  const connection = getPgtestUrl();
  const template = connection.pathname.replace(/\/$/, "") || "/metered";
  connection.pathname = `${template}/${idTest}`;
  const url = connection.toString();
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
