import type { Icon } from "@devdigest/ui";
import type { RiskSeverity } from "@devdigest/shared";

/** Severity → token colours for risk rows. */
export const SEV_COLOR: Record<RiskSeverity, { color: string; bg: string }> = {
  high: { color: "var(--crit)", bg: "var(--crit-bg)" },
  medium: { color: "var(--warn)", bg: "var(--warn-bg)" },
  low: { color: "var(--text-secondary)", bg: "var(--bg-hover)" },
};

/** Icon for each brief block (Intent · Blast · Risks · History). */
export const BLOCK_ICONS = {
  intent: "Target",
  blast: "Code",
  risks: "AlertTriangle",
  history: "History",
} satisfies Record<string, keyof typeof Icon>;

/** Max file refs to show under a risk row. */
export const MAX_RISK_FILE_REFS = 6;
