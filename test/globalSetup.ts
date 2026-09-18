import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import type { TestProject } from "vitest/node";
import { createDb } from "../src/infra/db/client.ts";
import { runMigrations } from "../src/infra/db/migrate.ts";
import fs from "node:fs/promises";
import type { PgTestContext } from "./support/integresql.js";
import { hashMigrationFiles } from "./support/migration-hash.ts";

const TIMESCALE_IMAGE = "timescale/timescaledb:2.29.2-pg18";

const TIMESCALE_CONTAINER_PORT = 5432;

const TIMESCALE_ENV = { user: "metered", password: "metered", database: "metered" };

const TIMESCALE_SOCKET_VOLUME = "metered-test-pgsock";
const TIMESCALE_SOCKET_DIR = "/var/run/postgresql";
const socketMount = { source: TIMESCALE_SOCKET_VOLUME, target: TIMESCALE_SOCKET_DIR };
const TIMESCALE_DATA_DIR = "/var/lib/postgresql";

const MIGRATIONS_DIRECTORY = fileURLToPath(new URL("../drizzle/", import.meta.url));
const HASH_FILE = new URL("../hash_migration.json", import.meta.url);

const reuseEnabled = process.env.TESTCONTAINERS_REUSE_ENABLE === "true";

let started: StartedTestContainer[] = [];

export default async function setup(project: TestProject) {
  const timescale = await startTimescale();
  const host = timescale.getHost();
  const port = timescale.getMappedPort(TIMESCALE_CONTAINER_PORT);

  const templateHash = await hashMigrationFiles(MIGRATIONS_DIRECTORY);
  const cached = await readMigrationCache();
  const containerId = timescale.getId();

  if (cached?.migration_hash !== templateHash || cached?.container_id !== containerId) {
    const { db, pool } = createDb(`postgres://metered:metered@${host}:${port}/metered`);
    try {
      await runMigrations(db);
      // Publish only completed migrations; readers see either the old cache or the complete new one.
      const temporaryFile = new URL(`../hash_migration.${randomUUID()}.tmp`, import.meta.url);
      try {
        await fs.writeFile(
          temporaryFile,
          JSON.stringify({ migration_hash: templateHash, container_id: containerId }, null, 2) +
            "\n",
        );
        await fs.rename(temporaryFile, HASH_FILE);
      } finally {
        await fs.rm(temporaryFile, { force: true });
      }
    } finally {
      await pool.end();
    }
  }

  const pgtest: PgTestContext = { host, port };
  project.provide("pgtest", pgtest);
}

async function readMigrationCache(): Promise<{
  migration_hash?: string;
  container_id?: string;
} | null> {
  try {
    return JSON.parse(await fs.readFile(HASH_FILE, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT")
      return null;
    throw error;
  }
}

export async function teardown() {
  if (reuseEnabled) return;
  await Promise.all(started.map((c) => c.stop()));
}

function startTimescale() {
  return (
    new GenericContainer(TIMESCALE_IMAGE)
      .withLabels({ "demo.blog.service": "metered", "demo.blog.role": "test-db" })
      .withEnvironment({
        POSTGRES_USER: TIMESCALE_ENV.user,
        POSTGRES_PASSWORD: TIMESCALE_ENV.password,
        POSTGRES_DB: TIMESCALE_ENV.database,
        POSTGRES_HOST_AUTH_METHOD: "trust",
      })
      // Throughput over durability: this database is disposable.
      .withCommand([
        "postgres",
        "-c",
        "file_copy_method=clone",
        "-c",
        "log_connections=authentication,authorization,setup_durations",
        "-c",
        "log_destination=stderr",
        "-c",
        "logging_collector=off",
        "-c",
        "log_line_prefix=%m [%p] user=%u db=%d app=%a",
        "-c",
        "wal_skip_threshold=0",
        "-c",
        "fsync=off",
        "-c",
        "synchronous_commit=off",
        "-c",
        "full_page_writes=off",
        "-c",
        "wal_level=minimal",
        "-c",
        "max_wal_senders=0",
        "-c",
        "archive_mode=off",
        "-c",
        "summarize_wal=off",
        "-c",
        "autovacuum=off",
        "-c",
        "timescaledb.max_background_workers=0",
        "-c",
        "random_page_cost=1.1",
      ])
      .withTmpFs({ [TIMESCALE_DATA_DIR]: "rw,noexec,nosuid,size=3g" })
      .withBindMounts([socketMount])
      .withExposedPorts(TIMESCALE_CONTAINER_PORT)
      // The official entrypoint starts postgres twice (init, then for real): wait for the second "ready".
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .withReuse()
      .start()
  );
}
