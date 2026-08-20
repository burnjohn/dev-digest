ALTER TABLE "findings" ADD CONSTRAINT "findings_severity_ck" CHECK ("findings"."severity" in ('CRITICAL', 'WARNING', 'SUGGESTION'));--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_category_ck" CHECK ("findings"."category" in ('bug', 'security', 'perf', 'style', 'test'));--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_kind_ck" CHECK ("findings"."kind" in ('finding', 'secret_leak', 'lethal_trifecta', 'phantom', 'hook'));--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_kind_ck" CHECK ("reviews"."kind" in ('summary', 'review'));--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_verdict_ck" CHECK ("reviews"."verdict" in ('request_changes', 'approve', 'comment'));--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_status_ck" CHECK ("agent_runs"."status" in ('running', 'done', 'failed', 'cancelled'));--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_source_ck" CHECK ("agent_runs"."source" in ('local', 'ci'));