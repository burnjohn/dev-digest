ALTER TABLE "agent_runs" ADD COLUMN "critical_count" integer;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "warning_count" integer;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "suggestion_count" integer;