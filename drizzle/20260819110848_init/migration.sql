CREATE TYPE "customer_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "customer_type" AS ENUM('individual', 'team');--> statement-breakpoint
CREATE TYPE "billing_plan" AS ENUM('free', 'pro', 'enterprise');--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"email" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"type" "customer_type" NOT NULL,
	"status" "customer_status" DEFAULT 'active'::"customer_status" NOT NULL,
	"polar_customer_id" text UNIQUE,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_profiles" (
	"customer_id" uuid PRIMARY KEY,
	"legal_name" text NOT NULL,
	"tax_id" text,
	"billing_email" text NOT NULL,
	"address" jsonb NOT NULL,
	"monthly_event_limit" integer NOT NULL,
	"rate_limit_per_minute" integer NOT NULL,
	"hard_limit" boolean DEFAULT true NOT NULL,
	"plan" "billing_plan" NOT NULL,
	"currency" char(3) NOT NULL,
	"price_per_unit_cents" integer NOT NULL,
	"included_units" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid DEFAULT uuidv7(),
	"occurred_at" timestamp with time zone,
	"customer_id" uuid NOT NULL,
	"event_name" text NOT NULL,
	"quantity" numeric(18,6) DEFAULT '1' NOT NULL,
	"external_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_events_pkey" PRIMARY KEY("occurred_at","id")
);
--> statement-breakpoint
ALTER TABLE "billing_profiles" ADD CONSTRAINT "billing_profiles_customer_id_customers_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE;