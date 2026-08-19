-- Custom migration (drizzle-kit generate --custom): TimescaleDB specifics for usage_events.
-- The table itself is created by the previous, drizzle-generated migration.

CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
--> statement-breakpoint
SELECT create_hypertable('usage_events', by_range('occurred_at', INTERVAL '7 days'));
--> statement-breakpoint
CREATE INDEX "usage_events_customer_time_idx" ON "usage_events" ("customer_id", "occurred_at" DESC);
--> statement-breakpoint
-- Idempotency: the same logical event (per customer) must not be stored twice.
-- The partition column must be part of every unique index on a hypertable.
CREATE UNIQUE INDEX "usage_events_customer_external_id_idx" ON "usage_events" ("customer_id", "external_id", "occurred_at");
--> statement-breakpoint
ALTER TABLE "usage_events" SET (
  timescaledb.enable_columnstore = true,
  timescaledb.segmentby = 'customer_id',
  timescaledb.orderby = 'occurred_at DESC'
);
--> statement-breakpoint
CALL add_columnstore_policy('usage_events', after => INTERVAL '30 days');
