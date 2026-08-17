ALTER TABLE "convention_scans" ADD COLUMN "dropped_unsupported" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "convention_scans" ADD COLUMN "counted_files" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "convention_scans" ADD COLUMN "counted_symbols" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "follow_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "violation_count" integer;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "conformance" double precision;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "probe_strategy" text;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "config_declared" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "signals" jsonb;