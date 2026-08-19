CREATE TABLE "billing_plans" (
	"code" text PRIMARY KEY,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_statuses" (
	"code" text PRIMARY KEY,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_types" (
	"code" text PRIMARY KEY,
	"label" text NOT NULL
);
--> statement-breakpoint
-- seeds (hand-added): lookup values previously encoded as PG enums
INSERT INTO "customer_types" ("code", "label") VALUES ('individual', 'Individual'), ('team', 'Team');--> statement-breakpoint
INSERT INTO "customer_statuses" ("code", "label") VALUES ('active', 'Active'), ('suspended', 'Suspended');--> statement-breakpoint
INSERT INTO "billing_plans" ("code", "label") VALUES ('free', 'Free'), ('pro', 'Pro'), ('enterprise', 'Enterprise');--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "type" SET DATA TYPE text USING "type"::text;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "status" SET DATA TYPE text USING "status"::text;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "status" SET DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "billing_profiles" ALTER COLUMN "plan" SET DATA TYPE text USING "plan"::text;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_type_customer_types_code_fkey" FOREIGN KEY ("type") REFERENCES "customer_types"("code");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_status_customer_statuses_code_fkey" FOREIGN KEY ("status") REFERENCES "customer_statuses"("code");--> statement-breakpoint
ALTER TABLE "billing_profiles" ADD CONSTRAINT "billing_profiles_plan_billing_plans_code_fkey" FOREIGN KEY ("plan") REFERENCES "billing_plans"("code");--> statement-breakpoint
DROP TYPE "customer_status";--> statement-breakpoint
DROP TYPE "customer_type";--> statement-breakpoint
DROP TYPE "billing_plan";