import type { IconName } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";

/** Per-skill-type accent colour + i18n key for the type chip. */
export const SKILL_TYPE: Record<Skill["type"], { c: string; labelKey: string }> = {
  rubric: { c: "#3b82f6", labelKey: "rubric" },
  convention: { c: "#10b981", labelKey: "convention" },
  security: { c: "#ef4444", labelKey: "security" },
  custom: { c: "#999999", labelKey: "custom" },
};

/** Per-source icon + i18n key for the source row. */
export const SKILL_SOURCE: Record<Skill["source"], { icon: IconName; labelKey: string }> = {
  manual: { icon: "Edit", labelKey: "manual" },
  extracted: { icon: "Wrench", labelKey: "extracted" },
  community: { icon: "Globe", labelKey: "community" },
  imported_url: { icon: "Link", labelKey: "imported_url" },
};
