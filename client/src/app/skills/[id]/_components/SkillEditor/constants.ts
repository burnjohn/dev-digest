import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `skills` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "preview", labelKey: "editor.tabs.preview", icon: "Eye" },
  { key: "evals", labelKey: "editor.tabs.evals", icon: "BarChart" },
  { key: "stats", labelKey: "editor.tabs.stats", icon: "TrendingUp" },
  { key: "versions", labelKey: "editor.tabs.versions", icon: "GitBranch" },
] as const;
