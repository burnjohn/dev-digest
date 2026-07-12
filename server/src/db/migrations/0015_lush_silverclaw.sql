CREATE TABLE "eval_run_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_kind" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"agent_version" integer NOT NULL,
	"label" text,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recall" double precision,
	"precision" double precision,
	"citation_accuracy" double precision,
	"total_cost_usd" double precision
);
--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "run_group_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_run_groups" ADD CONSTRAINT "eval_run_groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_run_group_id_eval_run_groups_id_fk" FOREIGN KEY ("run_group_id") REFERENCES "public"."eval_run_groups"("id") ON DELETE set null ON UPDATE no action;