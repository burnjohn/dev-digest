import type { IconName } from "@devdigest/ui";

/** Detail tab descriptor. `labelKey` resolves under the `skills` namespace. */
export interface DetailTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Detail tabs, in mockup order. Evals is a placeholder — see EvalsTab. */
export const TABS: readonly DetailTab[] = [
  { key: "config", labelKey: "detail.tabs.config", icon: "Settings" },
  { key: "preview", labelKey: "detail.tabs.preview", icon: "Eye" },
  { key: "evals", labelKey: "detail.tabs.evals", icon: "FlaskConical" },
  { key: "stats", labelKey: "detail.tabs.stats", icon: "BarChart" },
  { key: "versions", labelKey: "detail.tabs.versions", icon: "History" },
];

/** Valid tab keys, for validating the `?tab=` query param. */
export const TAB_KEYS: readonly string[] = TABS.map((tb) => tb.key);
