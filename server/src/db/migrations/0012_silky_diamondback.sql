CREATE INDEX "findings_review_idx" ON "findings" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "reviews_pr_created_idx" ON "reviews" USING btree ("pr_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_runs_pr_ran_at_idx" ON "agent_runs" USING btree ("pr_id","ran_at" DESC NULLS LAST);