CREATE TABLE "webhook_idempotency_keys" (
	"key" text PRIMARY KEY,
	"request_hash" text NOT NULL,
	"status" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_settlements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"customer_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"synced_events" integer NOT NULL,
	"synced_quantity" numeric(18,6) NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"currency" char(3),
	"polar_order_id" text,
	"polar_order_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- hand-added: the customer-scoped dedup index from the custom hypertable migration is replaced by event_id indexes
DROP INDEX IF EXISTS "usage_events_customer_external_id_idx";--> statement-breakpoint
ALTER TABLE "usage_events" RENAME COLUMN "external_id" TO "event_id";--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "polar_synced_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "usage_events_event_id_idx" ON "usage_events" ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_events_event_id_occurred_at_key" ON "usage_events" ("event_id","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_settlements_customer_idx" ON "usage_settlements" ("customer_id","created_at");