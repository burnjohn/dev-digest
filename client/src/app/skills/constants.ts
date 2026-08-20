import type { SkillType } from "@devdigest/shared";

/** Shared across the Skills rail and the skill editor. */

/** Chip colour per skill type. Mirrors the agent editor's Skills tab. */
export const TYPE_COLORS: Record<SkillType, string> = {
  rubric: "var(--accent)",
  convention: "var(--ok, #3fb950)",
  security: "var(--danger)",
  custom: "var(--text-secondary)",
};

/** Selectable types in the editor, in the order they are offered. */
export const TYPE_VALUES: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

/** A skill that did not come from this editor is third-party — badge it. */
export const THIRD_PARTY_SOURCES = ["imported_url", "community"] as const;

/** Icon per source, shown next to the type chip on a rail card. */
export const SOURCE_ICONS = {
  manual: "Edit",
  extracted: "Zap",
  community: "Globe",
  imported_url: "Upload",
} as const;

/** Width of the skills list rail. Matches the agents editor's rail. */
export const RAIL_WIDTH = 300;

export const DRAWER_WIDTH = 720;

/** Accepted upload extensions for import. */
export const IMPORT_ACCEPT = ".md,.markdown,.zip";

/** Editor tabs, in order. `labelKey` resolves under the `skills` namespace. */
export const EDITOR_TABS = [
  { key: "config", labelKey: "editor.tabs.config" },
  { key: "preview", labelKey: "editor.tabs.preview" },
  { key: "evals", labelKey: "editor.tabs.evals" },
  { key: "stats", labelKey: "editor.tabs.stats" },
  { key: "versions", labelKey: "editor.tabs.versions" },
] as const;

export const VALID_TABS: readonly string[] = EDITOR_TABS.map((t) => t.key);

/** Max length of the optional "what changed" note stored with a version.
    Mirrors MAX_VERSION_MESSAGE_CHARS in the server's skills module. */
export const MAX_VERSION_MESSAGE_CHARS = 200;
