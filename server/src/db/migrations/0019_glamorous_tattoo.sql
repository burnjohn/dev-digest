CREATE TABLE "eval_run_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_kind" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"owner_version" integer NOT NULL,
	"runner_agent_id" uuid,
	"runner_agent_version" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"recall" double precision,
	"precision" double precision,
	"citation_accuracy" double precision,
	"cases_passed" integer,
	"cases_total" integer,
	"cost_usd" double precision
);
--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "expectation_kind" text;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "forbidden_regions" jsonb;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "input_filename" text;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_run_batches" ADD CONSTRAINT "eval_run_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_run_batches" ADD CONSTRAINT "eval_run_batches_runner_agent_id_agents_id_fk" FOREIGN KEY ("runner_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_run_batches_owner_status_idx" ON "eval_run_batches" USING btree ("owner_kind","owner_id","status");--> statement-breakpoint
CREATE INDEX "eval_run_batches_ws_idx" ON "eval_run_batches" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "eval_run_batches_runner_agent_idx" ON "eval_run_batches" USING btree ("runner_agent_id");--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_batch_id_eval_run_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."eval_run_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_runs_batch_idx" ON "eval_runs" USING btree ("batch_id");