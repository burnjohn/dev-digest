ALTER TABLE "agent_runs" ADD COLUMN "findings_critical" integer;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "findings_warning" integer;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "findings_suggestion" integer;