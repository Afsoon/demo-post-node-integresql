import { IntegreSQLClient } from "@devoxa/integresql-client";
import { Client } from "pg";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import type { TestProject } from "vitest/node";
import { createDb } from "../src/infra/db/client.ts";
import { runMigrations } from "../src/infra/db/migrate.ts";
import type { IntegreSqlContext } from "./support/integresql.d.ts";

const TIMESCALE_IMAGE = "timescale/timescaledb:2.29.2-pg18";
const INTEGRESQL_IMAGE = "ghcr.io/allaboutapps/integresql:v1.1.0";

const TIMESCALE_CONTAINER_PORT = 5432;
const INTEGRESQL_CONTAINER_PORT = 5000;

const TIMESCALE_ENV = { user: "metered", password: "metered", database: "metered" };

const TIMESCALE_SOCKET_VOLUME = "metered-test-pgsock";
const TIMESCALE_SOCKET_DIR = "/var/run/postgresql";
const socketMount = { source: TIMESCALE_SOCKET_VOLUME, target: TIMESCALE_SOCKET_DIR };
const TIMESCALE_DATA_DIR = "/var/lib/postgresql";

const SCHEMA_FILES = ["drizzle/**/*.sql", "drizzle/**/*.json"];

const reuseEnabled = process.env.TESTCONTAINERS_REUSE_ENABLE === "true";

let started: StartedTestContainer[] = [];

export default async function setup(project: TestProject) {
  const timescale = await startTimescale();
  const host = timescale.getHost();
  const port = timescale.getMappedPort(TIMESCALE_CONTAINER_PORT);

  const integresql = await startIntegresql();
  started = [integresql, timescale];


  const url = `http://${integresql.getHost()}:${integresql.getMappedPort(INTEGRESQL_CONTAINER_PORT)}`;
  const client = new IntegreSQLClient({ url });
  const templateHash = await client.hashFiles(SCHEMA_FILES);

  if (await hasStaleTemplates({ host, port }, templateHash)) {
    await client.api.discardAllTemplates();
  }

  await client.initializeTemplate(templateHash, async (templateConfig) => {
    const { db, pool } = createDb(
      client.databaseConfigToConnectionUrl({ ...templateConfig, host, port }),
    );
    try {
      await runMigrations(db);
    } finally {
      await pool.end();
    }
  });

  const context: IntegreSqlContext = { url, templateHash, host, port };
  project.provide("integresql", context);
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
      })
      // Throughput over durability: this database is disposable.
      .withCommand([
        "postgres",
        "-c",
        "shared_buffers=128MB",
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
        "checkpoint_timeout=5min",
        "-c",
        "max_wal_size=1GB",
        "-c",
        "autovacuum=off",
        "-c",
        "jit=off",
        "-c",
        "track_io_timing=off",
        "-c",
        "random_page_cost=1.1",
        "-c",
        "max_connections=300",
        "-c",
        "client_min_messages=warning",
        "-c",
        "timescaledb.max_background_workers=0",
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

function startIntegresql() {
  return new GenericContainer(INTEGRESQL_IMAGE)
    .withLabels({ "demo.blog.service": "metered", "demo.blog.role": "test-integresql" })
    .withEnvironment({
      INTEGRESQL_PORT: String(INTEGRESQL_CONTAINER_PORT),
      INTEGRESQL_TEST_INITIAL_POOL_SIZE: "16",
      INTEGRESQL_TEST_MAX_POOL_SIZE: "96",
      PGHOST: TIMESCALE_SOCKET_DIR,
      PGPORT: String(TIMESCALE_CONTAINER_PORT),
      PGUSER: TIMESCALE_ENV.user,
      PGPASSWORD: TIMESCALE_ENV.password,
      PGDATABASE: TIMESCALE_ENV.database,
    })
    .withBindMounts([socketMount])
    .withExposedPorts(INTEGRESQL_CONTAINER_PORT)
    .withWaitStrategy(Wait.forLogMessage(/http server started/))
    .withReuse()
    .start();
}

async function hasStaleTemplates({ host, port }: { host: string; port: number }, currentHash: string) {
  const pg = new Client({
    host,
    port,
    user: TIMESCALE_ENV.user,
    password: TIMESCALE_ENV.password,
    database: TIMESCALE_ENV.database,
  });
  await pg.connect();
  try {
    const { rows } = await pg.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname LIKE 'integresql_template_%' AND datname <> $1",
      [`integresql_template_${currentHash}`],
    );
    return rows.length > 0;
  } finally {
    await pg.end();
  }
}
