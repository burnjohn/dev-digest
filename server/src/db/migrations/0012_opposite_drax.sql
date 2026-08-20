CREATE INDEX "reviews_pr_id_idx" ON "reviews" USING btree ("pr_id");--> statement-breakpoint
CREATE INDEX "reviews_run_id_idx" ON "reviews" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_runs_ws_pr_status_idx" ON "agent_runs" USING btree ("workspace_id","pr_id","status");