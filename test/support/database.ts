import { randomUUID } from "node:crypto";
import { inject } from "vitest";
import { createDb } from "../../src/infra/db/client.ts";

function getPgtestUrl() {
  if (process.env.PGTEST_DATABASE_URL) {
    const url = new URL(process.env.PGTEST_DATABASE_URL);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      throw new Error("PGTEST_DATABASE_URL must use postgres:// or postgresql://");
    }
    return url;
  }
  const { host, port } = inject("pgtest");
  const url = new URL("postgres://metered:metered@localhost/metered");
  url.searchParams.set("host", host);
  url.port = String(port);
  return url;
}

let globalTestDatabase: (ReturnType<typeof createDb> & { url: string }) | undefined;

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

/** Each lease gets an isolated clone. Close connections before releasing it. */
export async function createTestDatabase() {
  const id = randomUUID();
  const connection = getPgtestUrl();
  connection.pathname = `${connection.pathname.replace(/\/$/, "") || "/metered"}/${id}`;
  const url = connection.toString();
  // Every connection to a fresh clone is a cold backend (TimescaleDB catalog warm-up ≈ 15–60 ms):
  // keep the pool small. Sequential specs use 1, fan-outs still get parallelism.
  const max = Number(process.env.TEST_PG_POOL_MAX ?? "4");
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new Error("TEST_PG_POOL_MAX must be a positive integer");
  }
  const { db, pool } = createDb(url, { max });
  let released = false;

  return {
    db,
    pool,
    url,
    async release() {
      if (released) return;
      released = true;
      try {
        await pool.end();
      } finally {
        await getGlobalTestDatabase().pool.query("SELECT pgtest_release($1::text)", [id]);
      }
    },
  };
}

export type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
