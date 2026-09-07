DROP INDEX "eval_cases_source_finding_uq";--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "skill_version" integer;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "carrier_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "gates_bypassed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "arm_without" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_cases_source_finding_uq" ON "eval_cases" USING btree ("source_finding_id","owner_kind","owner_id");