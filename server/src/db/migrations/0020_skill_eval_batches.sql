CREATE TABLE "skill_eval_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"host_agent_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text,
	"snapshot_identity" jsonb NOT NULL,
	"model" text NOT NULL,
	"judge_score" double precision,
	"grounding_pass_rate" double precision,
	"cases_passing" integer,
	"cases_total" integer,
	"cost_usd" double precision,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "skill_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "skill_eval_batches" ADD CONSTRAINT "skill_eval_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_eval_batches" ADD CONSTRAINT "skill_eval_batches_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_eval_batches" ADD CONSTRAINT "skill_eval_batches_host_agent_id_agents_id_fk" FOREIGN KEY ("host_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skill_eval_batches_skill_id_idx" ON "skill_eval_batches" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "skill_eval_batches_host_agent_id_idx" ON "skill_eval_batches" USING btree ("host_agent_id");--> statement-breakpoint
CREATE INDEX "skill_eval_batches_workspace_id_idx" ON "skill_eval_batches" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_skill_batch_id_skill_eval_batches_id_fk" FOREIGN KEY ("skill_batch_id") REFERENCES "public"."skill_eval_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_runs_skill_batch_id_idx" ON "eval_runs" USING btree ("skill_batch_id");