CREATE TABLE "agent_context_docs" (
	"agent_id" uuid NOT NULL,
	"path" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "agent_context_docs_agent_id_path_pk" PRIMARY KEY("agent_id","path")
);
--> statement-breakpoint
CREATE TABLE "skill_context_docs" (
	"skill_id" uuid NOT NULL,
	"path" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "skill_context_docs_skill_id_path_pk" PRIMARY KEY("skill_id","path")
);
--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "context_folders" jsonb;--> statement-breakpoint
ALTER TABLE "pr_files" ADD COLUMN IF NOT EXISTS "pseudocode_summary" text;--> statement-breakpoint
ALTER TABLE "agent_context_docs" ADD CONSTRAINT "agent_context_docs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_context_docs" ADD CONSTRAINT "skill_context_docs_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_context_docs_agent_idx" ON "agent_context_docs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "skill_context_docs_skill_idx" ON "skill_context_docs" USING btree ("skill_id");