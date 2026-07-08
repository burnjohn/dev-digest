/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState, Icon, SEV } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { useFindingAction } from "@/lib/hooks/reviews";
import { KEY_TO_ACTION } from "./constants";
import { visibleFindings } from "./helpers";
import { s } from "./styles";

export function FindingsPanel({
  findings,
  prId,
  runId,
  repoFullName,
  headSha,
  agentId,
}: {
  findings: FindingRecord[];
  prId: string;
  runId?: string | null;
  repoFullName?: string | null;
  headSha?: string | null;
  agentId?: string | null;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const [hideLow, setHideLow] = React.useState(false);
  const [activeSeverity, setActiveSeverity] = React.useState<string | null>(null);
  const [focusIdx, setFocusIdx] = React.useState(0);

  // Reset the active severity filter when the run changes (e.g., switching between
  // runs in the accordion). `runId` is the stable, reliable signal — `findings[0]?.id`
  // is a fallback for call sites that do not provide a runId (e.g., tests).
  const resetKey = runId ?? (findings[0]?.id ?? null);
  React.useEffect(() => {
    setActiveSeverity(null);
    setFocusIdx(0);
  }, [resetKey]);

  const shown = React.useMemo(
    () => visibleFindings(findings, hideLow, activeSeverity),
    [findings, hideLow, activeSeverity],
  );

  // Count per severity across ALL findings (unfiltered) so the pills always show totals.
  const severityCounts = React.useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of findings) c[f.severity] = (c[f.severity] ?? 0) + 1;
    return c;
  }, [findings]);

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
        <div style={s.pillGroup}>
          {(["CRITICAL", "WARNING", "SUGGESTION"] as const).map((sev) => {
            const cnt = severityCounts[sev] ?? 0;
            if (!cnt) return null;
            const active = activeSeverity === sev;
            const { c: color, icon: iconName, label } = SEV[sev];
            const SevIcon = Icon[iconName];
            return (
              <button
                key={sev}
                type="button"
                style={s.pill(active, color)}
                onClick={() => setActiveSeverity(active ? null : sev)}
                title={active ? `Show all severities` : `Filter to ${label} only`}
              >
                <SevIcon size={11} />
                {label.slice(0, 4).toUpperCase()}
                <span style={s.pillCount(active)}>{cnt}</span>
              </button>
            );
          })}
        </div>
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
              agentId={agentId}
              onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
            />
          ))
        )}
      </div>
    </div>
  );
}
