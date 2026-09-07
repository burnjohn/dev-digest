"use client";

import { useTranslations } from "next-intl";
import { LineChart } from "@devdigest/ui";
import type { EvalTrendPoint } from "@devdigest/shared/contracts/eval-ci";
import { formatMetricPct } from "@/lib/eval-format";
import { s } from "./styles";

/** AC-44 — the three-metric trend. AC-55: accompanied by a visually-hidden
 *  table of the same values, so the trend has a non-graphical equivalent. */
export function TrendChart({ trend }: { trend: EvalTrendPoint[] }) {
  const t = useTranslations("eval");
  const na = t("notApplicable");

  if (trend.length < 2) return null;

  return (
    <div>
      <LineChart
        yMin={0}
        yMax={1}
        series={[
          { name: t("dashboard.legend.recall"), color: "var(--accent)", data: trend.map((p) => p.recall ?? 0) },
          { name: t("dashboard.legend.precision"), color: "var(--warn)", data: trend.map((p) => p.precision ?? 0) },
          {
            name: t("dashboard.legend.citation"),
            color: "var(--ok, var(--text-secondary))",
            data: trend.map((p) => p.citation_accuracy ?? 0),
          },
        ]}
        points={trend.map((p) => ({ version: p.agent_version, cost: p.cost_usd }))}
      />
      <table style={s.visuallyHidden}>
        <caption>{t("dashboard.metricTrend")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("dashboard.table.ranAt")}</th>
            <th scope="col">{t("dashboard.legend.recall")}</th>
            <th scope="col">{t("dashboard.legend.precision")}</th>
            <th scope="col">{t("dashboard.legend.citation")}</th>
          </tr>
        </thead>
        <tbody>
          {trend.map((p) => (
            <tr key={p.run_id}>
              <td>{p.ran_at}</td>
              <td>{formatMetricPct(p.recall, na)}</td>
              <td>{formatMetricPct(p.precision, na)}</td>
              <td>{formatMetricPct(p.citation_accuracy, na)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
