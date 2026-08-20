ALTER TABLE "conventions" ADD COLUMN "category" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "rationale" text;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "evidence_line" integer;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "conventions_repo_created_idx" ON "conventions" USING btree ("repo_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "conventions" DROP COLUMN "accepted";--> statement-breakpoint
ALTER TABLE "conventions" ADD CONSTRAINT "conventions_status_ck" CHECK ("conventions"."status" in ('pending', 'accepted', 'rejected'));--> statement-breakpoint
ALTER TABLE "conventions" ADD CONSTRAINT "conventions_category_ck" CHECK ("conventions"."category" in ('naming', 'structure', 'errors', 'testing', 'imports', 'typing', 'api', 'general'));