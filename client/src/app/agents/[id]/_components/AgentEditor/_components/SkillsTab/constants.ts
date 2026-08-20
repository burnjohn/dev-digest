import type { SkillType } from "@devdigest/shared";

/** Chip colour per skill type — matches the Skills page so a type reads the same everywhere. */
export const TYPE_COLORS: Record<SkillType, string> = {
  rubric: "var(--accent)",
  convention: "var(--info, #6b8afd)",
  security: "var(--danger)",
  custom: "var(--text-secondary)",
};

/** Drag payload key. Set on dragstart, read on drop. */
export const DRAG_MIME = "text/x-devdigest-skill-row";
