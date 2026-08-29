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
 * They were deliberately absent while eval runs and per-skill findings
 * attribution did not exist (L06/L08) — shipping a dead control costs more
 * trust than a missing one. SPEC-03 (the Eval Pipeline) now supplies the data
 * source for **Evals only**: the tab renders that skill's eval case list (T19)
 * and nothing else — no batch history, no metric cards, no trend chart. Those
 * need a rendered batch/dashboard surface this task deliberately does not add.
 * **Stats stays withheld** — per-skill findings attribution still does not
 * exist.
 */
export const TABS: SkillEditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "preview", labelKey: "editor.tabs.preview", icon: "Eye" },
  { key: "context", labelKey: "editor.tabs.context", icon: "FileText" },
  { key: "versions", labelKey: "editor.tabs.versions", icon: "History" },
  { key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" },
];

export const VALID_TABS = TABS.map((t) => t.key);

/**
 * Mirrors MAX_VERSION_MESSAGE_CHARS in the server's skills module, which is the
 * enforcing side (the route schema 422s past it). Used here only to stop the
 * input before a request can be rejected — same arrangement as
 * MAX_SKILL_BODY_CHARS in components/markdown-editor.
 */
export const MAX_VERSION_MESSAGE_CHARS = 200;
