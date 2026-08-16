import type { SkillType } from "@devdigest/shared";

/** Responsive card grid — matches the agents list so the two screens align. */
export const CARD_GRID_COLS = "repeat(auto-fill, minmax(300px, 1fr))";

/** Type options for the create form and the editor's Type select. */
export const SKILL_TYPES: SkillType[] = ["rubric", "convention", "security", "custom"];

/** Body a from-scratch skill starts with, so the editor is never blank. */
export const NEW_SKILL_BODY = "# New rule\n\nDescribe what the reviewer should flag.\n";
