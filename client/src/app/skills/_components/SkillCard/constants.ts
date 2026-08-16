import type { SkillType, SkillSource } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

/**
 * Type → badge colour. Reuses the severity/status CSS vars rather than new
 * ones, so the palette stays consistent with findings elsewhere in the app.
 *
 * One colour per type, and they must stay visually distinct: `--sugg` is the
 * same blue as `--accent`, so `convention` uses `--ok` (green) instead.
 */
export const TYPE_COLOR: Record<SkillType, string> = {
  rubric: "var(--accent)", // blue
  convention: "var(--ok)", // green
  security: "var(--crit)", // red
  custom: "var(--text-secondary)", // grey
};

/** Source → icon for the provenance chip. */
export const SOURCE_ICON: Record<SkillSource, IconName> = {
  manual: "Edit",
  extracted: "Sparkles",
  community: "Globe",
  imported_url: "Globe",
  imported_file: "FileText",
};

/**
 * Sources that did not originate in this workspace. These render the "unread"
 * hint until the user opens the skill — see the trust copy in skills.json.
 * `enabled` is the real gate; this is only a nudge to read before enabling.
 */
export const EXTERNAL_SOURCES: SkillSource[] = ["community", "imported_url", "imported_file"];
