import type { IconName } from "@devdigest/ui";

export interface SkillEditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/**
 * The editor's tabs.
 *
 * The mockup also shows **Evals** and **Stats** plus a "Run on evals" button.
 * They are deliberately absent: eval runs and per-skill findings attribution do
 * not exist yet (L06/L08), so those tabs would render empty shells and the
 * button would do nothing. Shipping a dead control costs more trust than a
 * missing one.
 */
export const TABS: SkillEditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "preview", labelKey: "editor.tabs.preview", icon: "Eye" },
  { key: "context", labelKey: "editor.tabs.context", icon: "FileText" },
  { key: "versions", labelKey: "editor.tabs.versions", icon: "History" },
];

export const VALID_TABS = TABS.map((t) => t.key);

/**
 * Mirrors MAX_VERSION_MESSAGE_CHARS in the server's skills module, which is the
 * enforcing side (the route schema 422s past it). Used here only to stop the
 * input before a request can be rejected — same arrangement as
 * MAX_SKILL_BODY_CHARS in components/markdown-editor.
 */
export const MAX_VERSION_MESSAGE_CHARS = 200;
