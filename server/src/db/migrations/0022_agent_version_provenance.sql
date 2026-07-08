ALTER TABLE "agent_versions" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD COLUMN "source_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_source_batch_id_eval_batches_id_fk" FOREIGN KEY ("source_batch_id") REFERENCES "public"."eval_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_versions_source_batch_id_idx" ON "agent_versions" USING btree ("source_batch_id");