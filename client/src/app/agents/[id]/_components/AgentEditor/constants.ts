import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `agents` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/**
 * Editor tabs. Evals / Stats / CI have i18n keys but no data source yet (L06/L08),
 * so they stay out rather than shipping empty shells.
 */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "skills", labelKey: "editor.tabs.skills", icon: "Sparkles" },
  { key: "context", labelKey: "editor.tabs.context", icon: "FileText" },
];

/** Tab keys the `?tab=` param may take — the page validates against this. */
export const VALID_TABS: readonly string[] = TABS.map((t) => t.key);
