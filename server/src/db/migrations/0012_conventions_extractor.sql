-- 0012_conventions_extractor.sql
-- Adds convention_scans, extends conventions, adds convention_skill_links.
-- RULES: add-only — never alter or drop existing columns.

--> statement-breakpoint
CREATE TABLE "convention_scans" (
    "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "workspace_id"        uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "repo_id"             uuid NOT NULL REFERENCES "repos"("id") ON DELETE CASCADE,
    "commit_sha"          text NOT NULL,
    "status"              text DEFAULT 'pending' NOT NULL,
    "scanned_file_count"  integer,
    "candidate_count"     integer,
    "verified_count"      integer,
    "created_at"          timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "convention_scans_ws_idx"   ON "convention_scans" ("workspace_id");
--> statement-breakpoint
CREATE INDEX "convention_scans_repo_idx" ON "convention_scans" ("repo_id");

-- Extend the existing conventions table (add-only, original columns untouched).
--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "category"            text;
--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "dedup_key"           text;
--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "scan_id"             uuid REFERENCES "convention_scans"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "evidence_line"       integer;
--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "evidence_line_end"   integer;
--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "evidence_url"        text;
--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "model_confidence"    double precision;
--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "verified_confidence" double precision;
--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "status"              text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "edited_rule"         text;
--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "created_at"          timestamp with time zone DEFAULT now() NOT NULL;

-- Backfill status from the legacy accepted boolean.
--> statement-breakpoint
UPDATE "conventions"
SET "status" = CASE WHEN "accepted" = true THEN 'accepted' ELSE 'pending' END;

-- Partial unique index for idempotent re-scan.
-- NULLs are distinct in PG so existing rows (dedup_key IS NULL) never conflict.
--> statement-breakpoint
CREATE UNIQUE INDEX "conventions_repo_dedup_uq"
    ON "conventions" ("repo_id", "dedup_key")
    WHERE "dedup_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "conventions_ws_idx" ON "conventions" ("workspace_id");

-- Tracks which accepted conventions were merged into which Skills.
--> statement-breakpoint
CREATE TABLE "convention_skill_links" (
    "convention_id" uuid NOT NULL REFERENCES "conventions"("id") ON DELETE CASCADE,
    "skill_id"      uuid NOT NULL REFERENCES "skills"("id")      ON DELETE CASCADE,
    PRIMARY KEY ("convention_id", "skill_id")
);
