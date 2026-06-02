/* FindingsPanel — severity filters + hide-low-confidence + j/k navigation +
   FindingCard list, wiring the accept/dismiss/learn/reply action hook (A2 §7). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Chip, Toggle, EmptyState, SEV } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import { FILTER_SEVERITIES, KEY_TO_ACTION } from "./constants";
import { countBySeverity, visibleFindings } from "./helpers";
import { s } from "./styles";

export function FindingsPanel({ findings, prId }: { findings: FindingRecord[]; prId: string }) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const [sevFilter, setSevFilter] = React.useState<Record<string, boolean>>({
    CRITICAL: true,
    WARNING: true,
    SUGGESTION: true,
  });
  const [hideLow, setHideLow] = React.useState(false);
  const [focusIdx, setFocusIdx] = React.useState(0);

  const counts = React.useMemo(() => countBySeverity(findings), [findings]);

  const shown = React.useMemo(
    () => visibleFindings(findings, sevFilter, hideLow),
    [findings, sevFilter, hideLow],
  );

  // j/k navigation + a/d/l shortcuts on the focused finding (§9 keyboard).
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
        {FILTER_SEVERITIES.map((sv) => (
          <Chip
            key={sv}
            active={sevFilter[sv]}
            onClick={() => setSevFilter((prev) => ({ ...prev, [sv]: !prev[sv] }))}
            icon={SEV[sv].icon}
            count={counts[sv] || 0}
            color={SEV[sv].c}
          >
            {SEV[sv].label}
          </Chip>
        ))}
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
              onAction={(act, reply) => action.mutate({ findingId: f.id, action: act, reply, prId })}
            />
          ))
        )}
      </div>
    </div>
  );
}
