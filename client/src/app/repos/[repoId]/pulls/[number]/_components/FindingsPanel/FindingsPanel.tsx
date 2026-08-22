/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState, SeverityBadge } from "@devdigest/ui";
import type { FindingRecord, Severity } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import { TargetFindingContext } from "../target-finding-context";
import { KEY_TO_ACTION, LOW_CONFIDENCE_THRESHOLD, SEVERITY_ORDER } from "./constants";
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

  const target = React.useContext(TargetFindingContext);
  // Resolved against THIS panel's own findings — `target` is a page-wide
  // signal shared by every FindingsPanel (FindingsTab wraps all review-run
  // accordions in one Provider), so `targetFinding` is the thing that is
  // null for every panel except the one that actually owns the id.
  const targetFinding = React.useMemo(
    () => (target ? (findings.find((f) => f.id === target.id) ?? null) : null),
    [target, findings],
  );

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

  // REQ-18: a filter that would hide the deep-link target is CLEARED, not
  // merely bypassed — the toolbar must show what is actually being shown.
  // REQ-33: the same effect then moves the keyboard cursor onto the target's
  // index in `shown` (the filtered, RENDERED list — never `findings`, whose
  // order and membership can both differ once a severity filter or sort is
  // applied). `shown` is a dependency so this effect re-fires a SECOND time
  // once the setSev/setHideLow calls above land: the first pass still sees
  // the pre-clear list and correctly finds no match, only the second pass
  // (with the filter already cleared) can find the target's true position.
  React.useEffect(() => {
    if (!targetFinding) return;
    if (sev && sev !== targetFinding.severity) setSev(null);
    if (hideLow && targetFinding.confidence < LOW_CONFIDENCE_THRESHOLD) setHideLow(false);

    const idx = shown.findIndex((f) => f.id === targetFinding.id);
    if (idx !== -1) setFocusIdx(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFinding, target?.n, shown]);

  // Clear a severity filter whose chip is no longer rendered (count dropped to 0
  // after toggling hide-low-confidence), so the list falls back to all findings
  // instead of a confusing empty state for an invisible chip.
  React.useEffect(() => {
    if (sev && counts[sev] === 0) setSev(null);
  }, [sev, counts]);

  // Reset the j/k cursor to the top whenever the visible set changes — unless
  // a deep-link target is active, in which case the effect above owns the
  // cursor and this one must stay out of its way.
  React.useEffect(() => {
    if (targetFinding) return;
    setFocusIdx(0);
  }, [sev, hideLow, targetFinding]);

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
              defaultExpanded={targetFinding ? f.id === targetFinding.id : i === 0}
              highlighted={f.id === target?.id}
              highlightNonce={target?.n}
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
