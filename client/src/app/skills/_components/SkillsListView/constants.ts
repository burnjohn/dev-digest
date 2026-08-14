import type { IconName } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";

/** Width of the narrow skills list column; the detail panel takes the rest. */
export const LIST_WIDTH = 300;

/** Selectable skill types, in the order the editor offers them. */
export const SKILL_TYPES: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

/** Accent per type — the same colour is used on the card badge and the preview header. */
export const TYPE_COLOR: Record<SkillType, string> = {
  rubric: "var(--accent)",
  convention: "var(--warn)",
  security: "var(--crit)",
  custom: "var(--text-secondary)",
};

/** Icon per type. */
export const TYPE_ICON: Record<SkillType, IconName> = {
  rubric: "ListChecks",
  convention: "Boxes",
  security: "Shield",
  custom: "Sparkles",
};
