ALTER TABLE "agent_skills" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "skills_workspace_idx" ON "skills" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_skills_skill_idx" ON "agent_skills" USING btree ("skill_id");--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_type_ck" CHECK ("skills"."type" in ('rubric', 'convention', 'security', 'custom'));--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_source_ck" CHECK ("skills"."source" in ('manual', 'imported_url', 'extracted', 'community'));