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

## Tests (vitest + integresql)

```sh
pnpm test          # or pnpm test:watch
```

- `vitest.config.ts` loads `.env.test` with Node's `process.loadEnvFile` (no dotenv) and forwards the keys to worker threads via `test.env`.
- `test/globalSetup.ts` (runs once): starts TimescaleDB + [integresql](https://github.com/allaboutapps/integresql) with testcontainers (shared unix-socket volume, random host ports, `withReuse()` — set `TESTCONTAINERS_REUSE_ENABLE=true`, already in `.env.test`), hashes `drizzle/**` into a template hash and migrates the template database with `runMigrations` from `src/infra/db/migrate.ts`. Only serializable values are `provide`d to workers. The test database lives on **tmpfs** (RAM, never fills the Docker disk), runs with `timescaledb.max_background_workers=0` (no scheduler per cloned DB), integresql's pool is capped at 96 clones, and templates of older schema hashes are discarded automatically.
- `test/support/database.ts` leases a clone of the template per test (`getTestDatabase`) and recreates it on release.
- `test/support/polar-mock.ts` — stateful in-memory double of the Polar endpoints we use (`/v1/customers/`, `/v1/events/ingest`, `/v1/orders/` + `/finalize`) served by an [MSW](https://mswjs.io) server. Local traffic (`http://127.0.0.1*`, `http://localhost*` → integresql API) passes through; any other URL throws (`onUnhandledRequest: 'error'`).
- `test/support/api.ts` — `TestApi`: own DB clone + **own MSW server** + container wired exactly like dev (`createBillingProviderFromEnv` → real Polar SDK adapters with the fake credentials from `.env.test`) + in-process Hono app (`hono/testing` `testClient`, fully typed RPC, no listening port) + auth header. It implements `Symbol.asyncDispose` (closes MSW, releases the clone), so tests read:

```ts
it("creates a customer", async () => {
  await using api = await TestApi.start();
  const res = await api.client.customers.$post({
    json: { email: "ada@example.com", name: "Ada", type: "individual" },
  });
  expect(res.status).toBe(201);
  expect(api.polar.state.customers.size).toBe(1); // what Polar "received"
  expect(api.polar.requests[0]).toMatchObject({ method: "POST", url: "/v1/customers/" });
}); // MSW closed + clone released here, no beforeEach/afterEach
```

- Spec style: `describe('<feature>') › describe('GIVEN <precondition>') › it('WHEN <action> THEN <outcome>')`; bodies are Arrange / Act / Assert blocks separated by blank lines (no comments). Preconditions are created **through the API** with the `given*` helpers in `test/support/fixtures.ts`; raw SQL (`sql*` helpers) only for states the API cannot produce (idempotency row in flight / expired). Request payloads come from `test/factories/` (`customerBody`, `billingProfileBody`, `usageEventBody`, `usageBatch`, `reportQuery`, …), typed from the RPC client so they follow the API contract.
- Stress suite `test/test/parallel/` (8 files): 1000-event batches, 600+ event syncs, 100-way `Promise.all` fan-outs, idempotency/delete races, instance churn. One live `TestApi` per spec (MSW shares one interceptor per worker thread), parallelism comes from worker threads: `pnpm test` ≈ 13s vs `pnpm vitest run --maxWorkers=1` ≈ 29s on 10 cores. The suite found and fixed a dedup race (advisory lock per eventId in `insertMany`) and float drift in `syncedQuantity`.
- Failure injection per instance: `api.polar.use(http.post(`${api.polar.baseUrl}/v1/customers/`, () => HttpResponse.json({}, { status: 500 })))` — overrides die with the instance (`test/test/polar-failures.test.ts`).

## CI

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests: `pnpm install --frozen-lockfile` → `pnpm typecheck` → migration drift check (`drizzle-kit generate` must produce nothing) → pre-pull of the TimescaleDB/integresql images → `pnpm test`. `ubuntu-latest` ships Docker, so testcontainers works unchanged; `TESTCONTAINERS_REUSE_ENABLE=false` is set in the job (`.env.test` never overrides existing variables) so every run gets fresh containers that the reaper removes. Container logs are dumped on failure. Replace `OWNER/REPO` in the badge above once the repo is on GitHub.

## Migrations

```sh
nub run db:generate                       # diff schema → new SQL migration
nub run db:generate:custom -- --name xyz  # empty migration for hand-written SQL
nub run db:migrate
```
