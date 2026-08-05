CREATE TABLE "github_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"label" text NOT NULL,
	"github_login" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_validated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "github_token_id" uuid;--> statement-breakpoint
ALTER TABLE "github_tokens" ADD CONSTRAINT "github_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "github_tokens_ws_label_uq" ON "github_tokens" USING btree ("workspace_id","label");--> statement-breakpoint
CREATE INDEX "github_tokens_ws_idx" ON "github_tokens" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_github_token_id_github_tokens_id_fk" FOREIGN KEY ("github_token_id") REFERENCES "public"."github_tokens"("id") ON DELETE set null ON UPDATE no action;