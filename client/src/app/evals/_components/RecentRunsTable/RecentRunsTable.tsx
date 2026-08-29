/* RecentRunsTable — the cross-agent runs feed on /evals.

   Columns are AGENT · DATE · VERSION · RECALL · PRECISION · CITATION · PASS.
   There is no
   CASE column and cannot be one: `EvalBatchRecord` carries neither a
   `case_id` nor a `case_name`, because a batch IS "run every case for this
   owner" — its case dimension is the PASS ratio. Per-case names exist only on
   `GET /evals/batches/:id`, which this table does not fetch.

   Every metric goes through `_lib/format.ts`, so a `null` renders "—" and
   never a misleading 0% — and a null metric draws no bar at all rather than
   an empty track that reads as "measured zero". */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatBatchTimestamp, formatPassRatio } from "../../_lib/format";
import { MetricBar } from "../MetricBar";
import type { RecentRunRow } from "./helpers";
import { s } from "./styles";

export function RecentRunsTable({ rows }: { rows: RecentRunRow[] }) {
  const t = useTranslations("eval");
  const tSkills = useTranslations("skills");

  if (rows.length === 0) {
    return <p style={s.empty}>{t("dashboard.noRuns")}</p>;
  }

  return (
    <div style={s.scroll}>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>{t("dashboard.table.agent")}</th>
            <th style={s.th}>{t("dashboard.table.date")}</th>
            <th style={s.th}>{t("dashboard.table.version")}</th>
            <th style={s.th}>{t("dashboard.table.recall")}</th>
            <th style={s.th}>{t("dashboard.table.precision")}</th>
            <th style={s.th}>{t("dashboard.table.citation")}</th>
            <th style={s.th}>{t("dashboard.table.pass")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ batch, agentId, agentName }) => (
            <tr key={batch.id}>
              <td style={s.td}>
                <Link href={`/evals/${agentId}`} style={s.agentLink}>
                  {agentName}
                </Link>
              </td>
              <td className="tnum" style={{ ...s.td, ...s.dateCell }}>
                {formatBatchTimestamp(batch.started_at)}
              </td>
              <td className="mono" style={{ ...s.td, ...s.versionCell }}>
                {tSkills("preview.version", { version: batch.owner_version })}
              </td>
              <td style={s.metricCell}>
                <MetricBar value={batch.recall} metric="recall" />
              </td>
              <td style={s.metricCell}>
                <MetricBar value={batch.precision} metric="precision" />
              </td>
              <td style={s.metricCell}>
                <MetricBar value={batch.citation_accuracy} metric="citation" />
              </td>
              <td className="tnum" style={s.passCell}>
                {formatPassRatio(batch.cases_passed, batch.cases_total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
