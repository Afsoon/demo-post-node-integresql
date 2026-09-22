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
import type { PgTestContext } from "./support/integresql.js";
import { deferTerminationUntil, PgtestContainer } from "./support/pgtest-container.ts";
import { hashMigrationFiles } from "./support/migration-hash.ts";

const TIMESCALE_IMAGE = "timescale/timescaledb:2.29.2-pg18";

const TIMESCALE_CONTAINER_PORT = 5432;

const TIMESCALE_ENV = { user: "metered", password: "metered", database: "metered" };

const TIMESCALE_SOCKET_DIR = "/var/run/postgresql";
const TIMESCALE_DATA_DIR = "/var/lib/postgresql";
const PGTEST_CONTAINER_PORT = 6432;

export default async function setup(project: TestProject) {
  const client = await getContainerRuntimeClient();
  const reuseTimescale = process.env.TESTCONTAINERS_REUSE_ENABLE === "true";
  const migrationHash = await hashMigrationFiles(
    fileURLToPath(new URL("../drizzle/", import.meta.url)),
  );
  let pgtestContainer: PgtestContainer | undefined;
  let timescale: StartedTestContainer | undefined;
  const startup = Promise.withResolvers<void>();
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () =>
    (cleanupPromise ??= (async () => {
      await startup.promise;
      const errors: unknown[] = [];
      // Stop pgtest before PostgreSQL, retaining pgtest for inspection.
      for (const action of [
        () => pgtestContainer?.stopForInspection(),
        async () => {
          if (!reuseTimescale) await timescale?.stop({ timeout: 10_000, removeVolumes: true });
        },
      ]) {
        try {
          await action();
        } catch (error) {
          errors.push(error);
        }
      }
      restoreSignals();
      if (errors.length) throw new AggregateError(errors, "Test container cleanup failed");
    })());
  const restoreSignals = deferTerminationUntil(cleanup);

  try {
    timescale = await startTimescale(migrationHash, reuseTimescale);
    const host = timescale.getHost();
    const port = timescale.getMappedPort(TIMESCALE_CONTAINER_PORT);
    // Idempotent migrations also complete initialization after an interrupted setup.
    const { db, pool } = createDb(`postgres://metered:metered@${host}:${port}/metered`);
    try {
      await runMigrations(db);
    } finally {
      await pool.end();
    }
    // Workers read this URL directly. The external server owns its lifecycle and logs.
    if (process.env.PGTEST_DATABASE_URL) return cleanup;

    const details = await client.container.inspect(client.container.getById(timescale.getId()));
    const socketVolume = details.Mounts.find((mount) => mount.Destination === TIMESCALE_SOCKET_DIR);
    if (socketVolume?.Type !== "volume" || !socketVolume.Name) {
      throw new Error("TimescaleDB did not expose its PostgreSQL socket volume");
    }
    const socketMount = { source: socketVolume.Name, target: TIMESCALE_SOCKET_DIR };
    pgtestContainer = new PgtestContainer(
      process.env.PGTEST_IMAGE || "pgtest-tokio-size-validation:local",
    );
    const pgtest = await pgtestContainer
      .withLabels({ "demo.blog.service": "metered", "demo.blog.role": "test-pgtest" })
      .withEnvironment({
        PGTEST_LISTEN_ADDR: "0.0.0.0",
        PGTEST_LISTEN_PORT: String(PGTEST_CONTAINER_PORT),
        // Upstream Unix socket: /var/run/postgresql/.s.PGSQL.5432.
        // PGTEST_UNIX_SOCKET_PORT configures the optional frontend, not this connection.
        PGTEST_PG_HOST: TIMESCALE_SOCKET_DIR,
        PGTEST_PG_PORT: String(TIMESCALE_CONTAINER_PORT),
        PGTEST_PG_USER: TIMESCALE_ENV.user,
        PGTEST_PG_DATABASE: TIMESCALE_ENV.database,
        PGTEST_POOL_INITIAL_SIZE: "32",
        PGTEST_CREATION_POOL_CONNECTION: "60",
        NO_COLOR: "1",
      })
      .withBindMounts([socketMount])
      .withExposedPorts(PGTEST_CONTAINER_PORT)
      // The image has no shell; wait for the server log instead of a shell port probe.
      .withWaitStrategy(Wait.forLogMessage(/pgtest server listening/))
      .withStartupTimeout(60_000)
      .start();
    const context: PgTestContext = {
      host: pgtest.getHost(),
      port: pgtest.getMappedPort(PGTEST_CONTAINER_PORT),
    };
    project.provide("pgtest", context);
  } catch (error) {
    startup.resolve();
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Test setup and cleanup failed");
    }
    throw error;
  } finally {
    startup.resolve();
  }
}

class TimescaleContainer extends GenericContainer {
  constructor() {
    super(TIMESCALE_IMAGE);
    // Docker owns this anonymous volume, which retained pgtest containers also reference.
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
      POSTGRES_USER: TIMESCALE_ENV.user,
      POSTGRES_PASSWORD: TIMESCALE_ENV.password,
      POSTGRES_DB: TIMESCALE_ENV.database,
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
    .withExposedPorts(TIMESCALE_CONTAINER_PORT)
    // The official entrypoint starts postgres twice (init, then for real): wait for the second "ready".
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2));
  if (reuse) container.withReuse();
  return container.start();
}
