import type { IconName } from "@devdigest/ui";
import type { OnboardingTourSectionKind, OnboardingTourTask } from "@devdigest/shared";

/** Complexity → color token map for FirstTasksSection badges (Low/Medium/High).
    Mirrors the shape of SEV in vendor/ui/primitives/tokens.ts but is defined
    LOCALLY here per the promotion rule — a single feature-local consumer does
    not warrant adding to the shared tokens.ts. */
export const COMPLEXITY: Record<OnboardingTourTask["complexity"], { c: string; bg: string }> = {
  low: { c: "var(--ok)", bg: "var(--ok-bg)" },
  medium: { c: "var(--warn)", bg: "var(--warn-bg)" },
  high: { c: "var(--crit)", bg: "var(--crit-bg)" },
};

/** Fixed section order + i18n-key mapping — the server always returns exactly
    these 5 kinds in this order (OnboardingTourSectionKind, Step 4 contract). */
export const SECTION_ORDER: { kind: OnboardingTourSectionKind; i18nKey: string; icon: IconName }[] = [
  { kind: "architecture", i18nKey: "architecture", icon: "Layers" },
  { kind: "critical_paths", i18nKey: "criticalPaths", icon: "GitBranch" },
  { kind: "how_to_run", i18nKey: "howToRun", icon: "Play" },
  { kind: "reading_path", i18nKey: "readingPath", icon: "FileText" },
  { kind: "first_tasks", i18nKey: "firstTasks", icon: "ListChecks" },
];

/** Compact relative time for the "last refreshed" subtitle (e.g. "3h", "2d"). */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const m = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
