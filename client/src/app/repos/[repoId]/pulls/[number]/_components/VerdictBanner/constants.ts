import type { IconName } from "@devdigest/ui";
import type { RiskLevel, Verdict } from "@devdigest/shared";

/** Per-verdict visual meta. `labelKey` resolves under the `verdict` namespace. */
export const VERDICT_META: Record<
  Verdict,
  { c: string; bg: string; icon: IconName; labelKey: string }
> = {
  request_changes: {
    c: "var(--crit)",
    bg: "var(--crit-bg)",
    icon: "XCircle",
    labelKey: "requestChanges",
  },
  approve: { c: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle", labelKey: "approve" },
  comment: { c: "var(--info)", bg: "var(--info-bg)", icon: "MessageSquare", labelKey: "comment" },
};

/**
 * Maps `risk_level` to a proxy 0-100 value fed into `CircularScore` solely to
 * drive its existing green/amber/red thresholds (>=75 ok / >=50 warn / else crit).
 * `risk_level` (string) remains the real source of truth — this is a display-only proxy.
 */
export const RISK_LEVEL_GAUGE: Record<RiskLevel, number> = {
  critical: 15,
  high: 40,
  medium: 65,
  low: 90,
};
