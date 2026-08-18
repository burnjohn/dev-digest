ALTER TABLE "pr_intent" ADD COLUMN "confidence" text DEFAULT 'high' NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "signals_used" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "risk_areas" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "head_sha" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD CONSTRAINT "pr_intent_confidence_check" CHECK ("pr_intent"."confidence" IN ('high', 'medium', 'low'));