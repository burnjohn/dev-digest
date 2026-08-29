import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `agents` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/**
 * Editor tabs. Stats / CI still have i18n keys but no data source yet
 * (L06/L08), so they stay out rather than shipping empty shells. Evals now
 * has one (SPEC-03's eval-cases + eval-runs tables, T8's hooks) and joins
 * the strip after Context.
 */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "skills", labelKey: "editor.tabs.skills", icon: "Sparkles" },
  { key: "context", labelKey: "editor.tabs.context", icon: "FileText" },
  { key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" },
];

/** Tab keys the `?tab=` param may take — the page validates against this. */
export const VALID_TABS: readonly string[] = TABS.map((t) => t.key);
