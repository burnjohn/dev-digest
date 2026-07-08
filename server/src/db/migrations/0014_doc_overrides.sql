CREATE TABLE "doc_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"path" text NOT NULL,
	"body" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "doc_overrides_repo_path_unique" UNIQUE("repo_id","path")
);
--> statement-breakpoint
ALTER TABLE "doc_overrides" ADD CONSTRAINT "doc_overrides_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doc_overrides_repo_idx" ON "doc_overrides" USING btree ("repo_id");