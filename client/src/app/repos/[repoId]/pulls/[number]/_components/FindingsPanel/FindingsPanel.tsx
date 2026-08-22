/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState, SEV, Icon } from "@devdigest/ui";
import type { FindingRecord, Severity } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import { KEY_TO_ACTION, SEVERITY_FILTERS } from "./constants";
import { visibleFindings } from "./helpers";
import { s } from "./styles";

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
  const [activeSeverity, setActiveSeverity] = React.useState<Severity | null>(
    null,
  );
  const [focusIdx, setFocusIdx] = React.useState(0);

  const counts = React.useMemo(
    () => ({
      CRITICAL: findings.filter((f) => f.severity === "CRITICAL").length,
      WARNING: findings.filter((f) => f.severity === "WARNING").length,
      SUGGESTION: findings.filter((f) => f.severity === "SUGGESTION").length,
    }),
    [findings],
  );

  const shown = React.useMemo(
    () => visibleFindings(findings, hideLow, activeSeverity),
    [findings, hideLow, activeSeverity],
  );

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({
          findingId: shown[focusIdx]!.id,
          action: KEY_TO_ACTION[e.key]!,
          prId,
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, action, prId]);

  return (
    <div>
      <div style={s.toolbar}>
        <div style={s.sevPills}>
          {SEVERITY_FILTERS.map(({ sev }) => {
            const n = counts[sev];
            if (!n) return null;
            const meta = SEV[sev];
            const SIcon = Icon[meta.icon];
            const active = activeSeverity === sev;
            return (
              <button
                key={sev}
                type="button"
                style={s.sevPill(active, meta.c)}
                onClick={() => setActiveSeverity(active ? null : sev)}
              >
                <SIcon size={12} />
                {n} {t(`panel.severity${sev}`)}
              </button>
            );
          })}
        </div>
        <div style={s.divider} />
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>
      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState
            icon="Filter"
            title={t("panel.noMatchTitle")}
            body={t("panel.noMatchBody")}
          />
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
              onAction={(act) =>
                action.mutate({ findingId: f.id, action: act, prId })
              }
            />
          ))
        )}
      </div>
    </div>
  );
}
