"use client";

/* KpiBanner (Agent Eval Dashboard detail page, AC-15) — a lightweight
   notice banner surfaced above the metrics/trend section when the agent's
   latest full batch shows a meaningful change vs. the previous full batch.
   "Meaningful" = at least one of the three KPI deltas is non-zero (per the
   plan's resolved NEEDS-CLARIFICATION — this codebase has no other existing
   "meaningful change" threshold convention to reuse).

   Renders NOTHING when:
   - `delta` is null (no previous full batch to compare against — the
     agent's first run), or
   - all three deltas are exactly 0 (no change worth flagging).

   When it does render, it names the SINGLE largest-magnitude metric and its
   direction (▲/▼), reusing `deltaColor()`/`fmtDelta()` from the EvalsTab
   helpers so the coloring/formatting convention matches every other delta
   shown in this codebase (EvalMetrics, KpiDeltaStrip, BatchCompare). */

import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { EvalKpiDeltaResponse } from "@devdigest/shared";
import { deltaColor, fmtDelta } from "@/components/eval";

type MetricKey = "recall" | "precision" | "citation_accuracy";

const METRIC_KEYS: MetricKey[] = ["recall", "precision", "citation_accuracy"];

export function KpiBanner({ delta }: { delta: EvalKpiDeltaResponse | undefined }) {
  const t = useTranslations("evals");

  if (!delta) return null;

  let largestKey: MetricKey | null = null;
  let largestAbs = 0;
  for (const key of METRIC_KEYS) {
    const abs = Math.abs(delta[key]);
    if (abs > largestAbs) {
      largestAbs = abs;
      largestKey = key;
    }
  }

  if (!largestKey || largestAbs === 0) return null;

  const value = delta[largestKey];
  const metricLabel = t(`detail.banner.metric.${largestKey}`);

  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "12px 16px",
        borderRadius: 8,
        background: "var(--warn-bg)",
        border: "1px solid var(--warn)",
        fontSize: 13,
        marginBottom: 20,
      }}
    >
      <Icon.AlertTriangle size={15} style={{ color: "var(--warn)", flexShrink: 0 }} />
      <span>
        {t("detail.banner.message", {
          metric: metricLabel,
          direction: value > 0 ? "▲" : "▼",
        })}
      </span>
      <span style={{ fontWeight: 700, color: deltaColor(value) }}>{fmtDelta(value)}</span>
    </div>
  );
}
