/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState } from "@devdigest/ui";
import type { FindingRecord, Severity } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import { KEY_TO_ACTION } from "./constants";
import { visibleFindings, countBySeverity } from "./helpers";
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
  const [sevFilter, setSevFilter] = React.useState<Severity | "all">("all");
  const [focusIdx, setFocusIdx] = React.useState(0);

  const counts = React.useMemo(() => countBySeverity(findings), [findings]);
  const shown = React.useMemo(() => visibleFindings(findings, hideLow, sevFilter), [findings, hideLow, sevFilter]);

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
        {(["all", "CRITICAL", "WARNING", "SUGGESTION"] as const).map((key) => {
          const count = key === "all" ? findings.length : counts[key];
          const colors: Record<string, string> = {
            CRITICAL: "var(--crit)",
            WARNING: "var(--warn)",
            SUGGESTION: "var(--ok)",
          };
          const active = sevFilter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => { setSevFilter(key); setFocusIdx(0); }}
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "3px 8px",
                borderRadius: 5,
                border: `1px solid ${active ? (colors[key] ?? "var(--border)") : "var(--border)"}`,
                background: active ? (key === "all" ? "var(--bg-hover)" : `color-mix(in srgb, ${colors[key]} 15%, transparent)`) : "transparent",
                color: active ? (colors[key] ?? "var(--text-primary)") : "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              {key === "all" ? `ALL · ${count}` : `${key} · ${count}`}
            </button>
          );
        })}
        <div style={s.divider} />
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
