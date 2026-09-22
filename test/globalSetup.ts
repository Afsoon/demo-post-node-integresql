import { fileURLToPath } from "node:url";
import {
  GenericContainer,
  getContainerRuntimeClient,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import type { TestProject } from "vitest/node";
import { createDb } from "../src/infra/db/client.ts";
import { runMigrations } from "../src/infra/db/migrate.ts";
import type { PgTestContext } from "./support/pgtest.d.ts";
import { hashMigrationFiles } from "./support/migration-hash.ts";

const TIMESCALE_IMAGE = "timescale/timescaledb:2.29.2-pg18";
const PGTEST_IMAGE = "ghcr.io/afsoon/pgtest:sha-e34dc67955c5";

const TIMESCALE_PORT = 5432;
const PGTEST_PORT = 6432;

const DATABASE_ENV = { user: "metered", password: "metered", database: "metered" };

const TIMESCALE_SOCKET_DIR = "/var/run/postgresql";
const TIMESCALE_DATA_DIR = "/var/lib/postgresql";

export default async function setup(project: TestProject) {
  const reuseTimescale = process.env.TESTCONTAINERS_REUSE_ENABLE === "true";
  const migrationHash = await hashMigrationFiles(
    fileURLToPath(new URL("../drizzle/", import.meta.url)),
  );
  let timescale: StartedTestContainer | undefined;
  let pgtest: StartedTestContainer | undefined;
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () =>
    (cleanupPromise ??= (async () => {
      try {
        // Retain the stopped pgtest container for inspection. No report capture.
        await pgtest?.stop({ timeout: 10_000, remove: false });
      } finally {
        if (!reuseTimescale) await timescale?.stop({ timeout: 10_000 });
      }
    })());

  try {
    timescale = await startTimescale(migrationHash, reuseTimescale);
    const templateUrl = new URL("postgres://metered:metered@localhost/metered");
    templateUrl.searchParams.set("host", timescale.getHost());
    templateUrl.port = String(timescale.getMappedPort(TIMESCALE_PORT));
    const { db, pool } = createDb(templateUrl.toString());
    try {
      await runMigrations(db);
    } finally {
      await pool.end();
    }

    const runtime = await getContainerRuntimeClient();
    const details = await runtime.container.inspect(runtime.container.getById(timescale.getId()));
    const volume = details.Mounts.find((mount) => mount.Destination === TIMESCALE_SOCKET_DIR);
    if (volume?.Type !== "volume" || !volume.Name) {
      throw new Error("TimescaleDB did not expose its PostgreSQL socket volume");
    }
    pgtest = await startPgTest(volume.Name);
    const context: PgTestContext = {
      host: pgtest.getHost(),
      port: pgtest.getMappedPort(PGTEST_PORT),
    };
    project.provide("pgtest", context);
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Test setup and cleanup failed");
    }
    throw error;
  }
}

class TimescaleContainer extends GenericContainer {
  constructor() {
    super(TIMESCALE_IMAGE);
    this.createOpts.Volumes = { [TIMESCALE_SOCKET_DIR]: {} };
  }
}

function startTimescale(migrationHash: string, reuse: boolean) {
  const container = new TimescaleContainer()
    .withLabels({
      "demo.blog.service": "metered",
      "demo.blog.role": "test-db",
      "demo.blog.migrations": migrationHash,
    })
    .withEnvironment({
      POSTGRES_USER: DATABASE_ENV.user,
      POSTGRES_PASSWORD: DATABASE_ENV.password,
      POSTGRES_DB: DATABASE_ENV.database,
      POSTGRES_HOST_AUTH_METHOD: "trust",
    })
    // Throughput over durability: this database is disposable.
    .withCommand([
      "postgres",
      "-c",
      `unix_socket_directories=${TIMESCALE_SOCKET_DIR}`,
      "-c",
      "unix_socket_permissions=0777",
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
    .withExposedPorts(TIMESCALE_PORT)
    // The official entrypoint starts postgres twice (init, then for real): wait for the second "ready".
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2));
  if (reuse) container.withReuse();
  return container.start();
}

function startPgTest(socketVolume: string) {
  return new GenericContainer(PGTEST_IMAGE)
    .withLabels({ "demo.blog.service": "metered", "demo.blog.role": "test-pgtest" })
    .withEnvironment({
      PGTEST_LISTEN_ADDR: "0.0.0.0",
      PGTEST_LISTEN_PORT: String(PGTEST_PORT),
      PGTEST_PG_HOST: TIMESCALE_SOCKET_DIR,
      PGTEST_PG_PORT: String(TIMESCALE_PORT),
      PGTEST_PG_USER: DATABASE_ENV.user,
      PGTEST_PG_DATABASE: DATABASE_ENV.database,
      PGTEST_POOL_INITIAL_SIZE: "16",
      NO_COLOR: "1",
    })
    .withBindMounts([{ source: socketVolume, target: TIMESCALE_SOCKET_DIR }])
    .withExposedPorts(PGTEST_PORT)
    .withWaitStrategy(Wait.forLogMessage(/pgtest server listening/))
    .withStartupTimeout(60_000)
    .withReuse()
    .start();
}
