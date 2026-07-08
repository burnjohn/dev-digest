CREATE INDEX IF NOT EXISTS "eval_batches_agent_id_idx" ON "eval_batches" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "eval_batches_workspace_id_idx" ON "eval_batches" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "eval_runs_batch_id_idx" ON "eval_runs" USING btree ("batch_id");