ALTER TABLE "onboarding" ADD COLUMN "mode" text DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "index_status" text DEFAULT 'degraded' NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "degraded" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "degraded_reason" text;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "llm_cost_cents" integer;