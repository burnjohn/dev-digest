import type { IconName } from "@devdigest/ui";
import type { SmartDiffRole } from "@devdigest/shared";

/** Per-role visual meta. `labelKey` resolves under the `smartDiff` namespace. */
export const ROLE_META: Record<SmartDiffRole, { labelKey: string; icon: IconName; color: string }> = {
  core: { labelKey: "coreLabel", icon: "Boxes", color: "var(--accent-text)" },
  wiring: { labelKey: "wiringLabel", icon: "Workflow", color: "var(--warn)" },
  boilerplate: { labelKey: "boilerplateLabel", icon: "FileText", color: "var(--text-muted)" },
};
