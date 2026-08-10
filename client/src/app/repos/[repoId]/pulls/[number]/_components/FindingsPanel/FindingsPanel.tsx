/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState, SeverityBadge } from "@devdigest/ui";
import type { FindingRecord, Severity } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import { KEY_TO_ACTION, SEVERITY_ORDER } from "./constants";
import { severityCounts, visibleFindings } from "./helpers";
import { s } from "./styles";

/** Existing i18n keys reused for the icon-only chips' accessible names. */
const ARIA_KEY: Record<Severity, string> = {
  CRITICAL: "findings.indicator.ariaCritical",
  WARNING: "findings.indicator.ariaWarning",
  SUGGESTION: "findings.indicator.ariaSuggestion",
};

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const [hideLow, setHideLow] = React.useState(false);
  const [sev, setSev] = React.useState<Severity | null>(null);
  const [focusIdx, setFocusIdx] = React.useState(0);

  // Counts are tallied after the confidence filter so a chip's number matches
  // exactly what clicking it reveals; the shown list applies both filters.
  const counts = React.useMemo(() => severityCounts(findings, hideLow), [findings, hideLow]);
  const shown = React.useMemo(
    () => visibleFindings(findings, hideLow, sev),
    [findings, hideLow, sev],
  );
  const present = React.useMemo(
    () =>
      (Object.keys(counts) as Severity[])
        .filter((S) => counts[S] > 0)
        .sort((a, b) => (SEVERITY_ORDER[a] ?? 9) - (SEVERITY_ORDER[b] ?? 9)),
    [counts],
  );

  // Clear a severity filter whose chip is no longer rendered (count dropped to 0
  // after toggling hide-low-confidence), so the list falls back to all findings
  // instead of a confusing empty state for an invisible chip.
  React.useEffect(() => {
    if (sev && counts[sev] === 0) setSev(null);
  }, [sev, counts]);

  // Reset the j/k cursor to the top whenever the visible set changes.
  React.useEffect(() => {
    setFocusIdx(0);
  }, [sev, hideLow]);

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, action, prId]);

  return (
    <div>
      <div style={s.toolbar}>
        {present.map((S) => (
          <button
            key={S}
            type="button"
            aria-label={t(ARIA_KEY[S], { count: counts[S] })}
            style={s.chip(sev === S)}
            onClick={() => setSev((p) => (p === S ? null : S))}
          >
            <SeverityBadge severity={S} count={counts[S]} compact />
          </button>
        ))}
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focusIdx}
              defaultExpanded={i === 0}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
            />
          ))
        )}
      </div>
    </div>
  );
}
