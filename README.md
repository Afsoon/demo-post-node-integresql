# Metered usage service — demo for integresql + MSW + vitest

[![CI](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/ci.yml)

Small but realistic Node/TypeScript microservice used as the playground for a blog post on
testing with [integresql](https://github.com/allaboutapps/integresql) and [MSW](https://mswjs.io).

Stack: Hono · valibot · hono-openapi + Scalar · drizzle-orm (node-postgres) · TimescaleDB (PostgreSQL 18) · Polar SDK.

## What is in here (phases 1–3)

- `docker-compose.yml` runs `timescale/timescaledb:2.29.2-pg18`.
- CRUD `/customers` and `/customers/:customerId/billing-profile` (company info, usage limits, pricing).
- `POST /webhooks/usage-events` — batch ingestion (1..1000 events) into the `usage_events` hypertable. Dedup on the producer-owned `eventId` (global, any customer/time); partial acceptance (per-item `rejected` list). Requires `x-idempotency-id`: same key + same body within 72h replays the stored response (`Idempotent-Replayed: true`), different body → 422, still processing → 409 (`webhook_idempotency_keys` table).
- `GET /customers/:customerId/usage/current` — current UTC month totals + limit status from the billing profile.
- `GET /customers/:customerId/usage?start&end&bucket` — totals + `time_bucket` series (hour|day|week|month, ≤ 366 days).
- `POST /customers/:customerId/usage/sync` `{start,end}` — forwards unsynced events to Polar (`events.ingest`, `external_id` = eventId), then charges `syncedQuantity × pricePerUnitCents` with an off-session order (`orders.create` + `finalize`, product = `POLAR_PRODUCT_ID`); free plan / zero → no order. Retry-safe (`polar_synced_at`), every run audited in `usage_settlements`.
- `DELETE /customers/:id` settles the current month the same way before deleting the Polar mirror and the row; returns `200 {customerId, settlement}`.
- Domain invariants (customer, billing profile, usage event) are valibot schemas (`parseEntity` → 422 with flattened issues), normalizing input (trim, lowercase emails, uppercase country/currency).
- Bearer auth on every API route (`Authorization: Bearer $API_TOKEN`); `/health`, `/openapi`, `/docs` are public.
- Every endpoint validates with valibot and is described in the OpenAPI document (`/openapi`, UI at `/docs`, with the bearer security scheme).
- Customers are mirrored into Polar (`external_id` = our id) through a port; without `POLAR_ACCESS_TOKEN` a no-op adapter is used.
- Migrations: drizzle-kit generates SQL from the schema; TimescaleDB specifics (hypertable, indexes, columnstore policy) live in a hand-written custom migration. Enumerations are lookup tables (`customer_types`, `customer_statuses`, `billing_plans`) seeded in their migration, not PG enums.

## Run

```sh
nub install
cp .env.example .env.development
nub run db:up          # docker compose up -d
nub run db:migrate     # applies ./drizzle/* (programmatic drizzle migrator)
nub run dev            # http://localhost:3000/docs
```

Env files are gitignored: `.env.development` holds the local defaults (copied from `.env.example`), `.env.local` overrides it — put your `POLAR_ACCESS_TOKEN` (and a real `API_TOKEN`) there.

The app (development and production), migrations, and Drizzle tooling accept TCP or Unix sockets through `DATABASE_URL`. Tests select their pgtest endpoint with `PGTEST_DATABASE_URL`; both the shared control client and isolated clients use that transport.

| Setting | TCP example | Unix socket example |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://metered:metered@localhost:5432/metered` | `postgres://metered:metered@%2Ftmp%2Fpgtest:6432/metered` |
| `PGTEST_DATABASE_URL` | `postgres://metered:metered@localhost:6432/metered` | `postgres://metered:metered@%2Ftmp%2Fpgtest:6432/metered` |

The socket URL encodes the directory as `%2Ftmp%2Fpgtest`, connecting through `/tmp/pgtest/.s.PGSQL.6432`. Development defaults to this socket; start pgtest with `socket_dir="/tmp/pgtest"` and port `6432` before running migrations or the app. Docker Compose starts the backing TimescaleDB service only. Set `DATABASE_URL` to the TCP example to connect directly to that service. Production can supply its own host, credentials, and connection options in the URL.

### Try it

```sh
TOKEN=dev-token-change-me-please
curl -s -X POST localhost:3000/customers -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","name":"Ada","type":"individual"}'
# → {"id":"<customerId>",...}
curl -s -X POST localhost:3000/webhooks/usage-events -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -H 'x-idempotency-id: batch-0001' \
  -d '[{"customerId":"<customerId>","eventName":"api_call","eventId":"evt-1","quantity":3}]'
# → {"received":1,"inserted":1,"duplicates":0,"rejected":[]}
curl -s localhost:3000/customers/<customerId>/usage/current -H "Authorization: Bearer $TOKEN"
curl -s "localhost:3000/customers/<customerId>/usage?start=2026-08-01T00:00:00Z&end=2026-09-01T00:00:00Z&bucket=day" -H "Authorization: Bearer $TOKEN"
curl -s -X POST localhost:3000/customers/<customerId>/usage/sync -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"start":"2026-08-01T00:00:00Z","end":"2026-09-01T00:00:00Z"}'
# → {"syncedEvents":1,"syncedQuantity":3,"charge":{"amountCents":...,"orderId":"..."},...}
```

## Project layout

```
src/
  index.ts                 bootstrap (env → container → app → serve)
  app.ts                   Hono app: routes, error handler, /openapi, /docs
  container.ts             composition root (manual DI)
  config/env.ts            valibot-validated environment
  shared/                  errors, http helpers (validate/describeRoute wrappers, error handler)
  infra/
    db/                    drizzle client, schema/*, migrate runner
    polar/                 Polar SDK client factory
  modules/
    customers/
      domain/              Customer aggregate + ports (repository, billing provider)
      infra/               drizzle repository, Polar adapter (+ no-op adapter)
      use-cases/<name>/    vertical slice: use-case.ts, schema.ts, route.ts
      routes.ts, schemas.ts, index.ts (module wiring)
    billing/               same shape for the BillingProfile aggregate
    usage/                 UsageEvent (hypertable) — ingestion webhook, current/range reports, Polar sync + charge
  shared/http/idempotency.ts  x-idempotency-id middleware (port) · infra/idempotency/ drizzle store
drizzle/                   migrations (generated + custom SQL)
```

## Tests (Vitest + pgtest)

```sh
pnpm test          # or pnpm test:watch
```

Unless `PGTEST_DATABASE_URL` selects an external server, the local `pgtest-tokio-size-validation:local` image must be available to Docker. Set `PGTEST_IMAGE` to use another image with the same listener configuration. Locally, `TESTCONTAINERS_REUSE_ENABLE=true` keeps TimescaleDB and its socket volume running between test runs. The managed containers communicate as follows:

```text
Vitest clients ── TCP (mapped port) ──> pgtest ── Unix socket ──> TimescaleDB
                                          /var/run/postgresql/.s.PGSQL.5432
```

The pgtest TCP listener uses `PGTEST_LISTEN_ADDR=0.0.0.0` and `PGTEST_LISTEN_PORT=6432`. Its upstream connection uses `PGTEST_PG_HOST=/var/run/postgresql` and `PGTEST_PG_PORT=5432`. `PGTEST_UNIX_SOCKET_PORT` belongs to pgtest's optional frontend Unix listener and is not used in this setup.

pgtest is stopped with SIGINT and retained for inspection after each run, including readiness failures. Automatic cleanup and removal are disabled; the suite does not save performance reports or log files. Its container ID is printed during startup; inspect its output with `docker logs <container-id>`. Ctrl-C/SIGTERM waits for managed containers to stop before the runner exits. Set `TESTCONTAINERS_REUSE_ENABLE=false` to remove TimescaleDB after the run; CI uses this setting. The socket volume remains referenced by retained pgtest containers until you remove them.

- `vitest.config.ts` loads `.env.test` with Node's `process.loadEnvFile` (no dotenv) and forwards the keys to worker threads via `test.env`.
- `test/globalSetup.ts` starts or reuses TimescaleDB, applies migrations to `metered`, then starts a fresh pgtest using the shared PostgreSQL socket. The migration hash is part of TimescaleDB's reuse identity, so changing migration files selects a fresh container and socket volume. Earlier reusable containers remain available until explicitly removed. It provides pgtest's mapped TCP host and port to workers. No migration cache file is needed.
- `test/support/database.ts` defaults to the managed pgtest TCP endpoint, connecting isolated clients to `metered/<test-id>` and the shared `getGlobalTestDatabase()` client to `pgtest`. Setting `PGTEST_DATABASE_URL` uses an external TCP or Unix socket endpoint and skips the pgtest container entirely. TimescaleDB setup and migrations still run; the external pgtest server is not stopped and its logs are not managed by this suite. The legacy `PGTEST_SOCKET_DIR` and `PGTEST_SOCKET_PORT` settings also remain supported. The shared client exposes `{ db, pool, url }`: use `pool.query(...)` for raw PostgreSQL queries or `db` for Drizzle. `test/setup.ts` closes the shared pool after each test file.
- `test/support/polar-mock.ts` — stateful in-memory double of the Polar endpoints we use (`/v1/customers/`, `/v1/events/ingest`, `/v1/orders/` + `/finalize`) served by an [MSW](https://mswjs.io) server. Local traffic (`http://127.0.0.1*`, `http://localhost*` → integresql API) passes through; any other URL throws (`onUnhandledRequest: 'error'`).
- `test/setup.ts` starts one MSW server per worker for each file and wraps each test with `server.boundary()` via `aroundEach`. Tests can run concurrently without sharing handler overrides.
- `test/support/api.ts` — `TestApi`: own DB clone + **own MSW boundary and mock state** + container wired exactly like dev (`createBillingProviderFromEnv` → real Polar SDK adapters with the fake credentials from `.env.test`) + in-process Hono app (`hono/testing` `testClient`, fully typed RPC, no listening port) + auth header. App requests and mock overrides re-enter the instance's boundary, so multiple instances can coexist in one test. It implements `Symbol.asyncDispose` (releases the clone), so tests read:

```ts
it("creates a customer", async () => {
  await using api = await TestApi.start();
  const res = await api.client.customers.$post({
    json: { email: "ada@example.com", name: "Ada", type: "individual" },
  });
  expect(res.status).toBe(201);
  expect(api.polar.state.customers.size).toBe(1); // what Polar "received"
  expect(api.polar.requests[0]).toMatchObject({ method: "POST", url: "/v1/customers/" });
}); // Clone released here; MSW boundaries keep this instance's handlers isolated.
```

- Spec style: `describe('<feature>') › describe('GIVEN <precondition>') › it('WHEN <action> THEN <outcome>')`; bodies are Arrange / Act / Assert blocks separated by blank lines (no comments). Preconditions are created **through the API** with the `given*` helpers in `test/support/fixtures.ts`; raw SQL (`sql*` helpers) only for states the API cannot produce (idempotency row in flight / expired). Request payloads come from `test/factories/` (`customerBody`, `billingProfileBody`, `usageEventBody`, `usageBatch`, `reportQuery`, …), typed from the RPC client so they follow the API contract.
- Stress suite `test/test/parallel/` (8 files): 1000-event batches, 600+ event syncs, 100-way `Promise.all` fan-outs, idempotency/delete races, instance churn. Test files run across worker threads, and `sequence.concurrent: true` enables concurrent tests within each worker. The suite found and fixed a dedup race (advisory lock per eventId in `insertMany`) and float drift in `syncedQuantity`.
- Failure injection per instance: `api.polar.use(http.post(`${api.polar.baseUrl}/v1/customers/`, () => HttpResponse.json({}, { status: 500 })))` — overrides stay inside the instance's boundary. `api.polar.resetHandlers()` restores its default handlers without clearing its data or affecting other instances (`test/test/polar-failures.test.ts`).

## CI

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests, as two parallel lanes with no serial hops:

```
check   typecheck → drizzle drift check (no Docker)
test    matrix shard 1..3 → node_modules cache → image cache (docker load, pull+save on miss)
        → containers → vitest run --shard=i/3 --reporter=blob --reporter=default → upload blob-i
```

Each shard boots its own TimescaleDB + pgtest on its runner. `node_modules` is cached by lockfile hash (install skipped on a hit; the pnpm store cache is the fallback) and the two images as one tarball keyed by `PGTEST_IMAGE` and `test/globalSetup.ts`. There is no merge job: shards fail the workflow on their own; for a single merged summary run `gh run download <run-id> -p 'blob-*' -D .vitest-reports && pnpm vitest run --merge-reports`. Change the shard count in `env.SHARDS` + the matrix. Local sharding is not used: on one machine it only doubles the setup for the same cores (measured slower).

Hosted runners do not have your local alpha image: set the repository variable `PGTEST_IMAGE` to a published image they can pull (and configure registry authentication if needed). Every CI run uses fresh containers. The workflow prints Docker logs on failure; no performance report artifacts are uploaded. Replace `OWNER/REPO` in the badge above once the repo is on GitHub.

`VITEST_MAX_WORKERS` (number or percentage) overrides the `50%` default; CI pins `75%` (3 of 4 vCPUs — measured ~8 s faster per shard than 50%).

## Migrations

```sh
nub run db:generate                       # diff schema → new SQL migration
nub run db:generate:custom -- --name xyz  # empty migration for hand-written SQL
nub run db:migrate
```
