"use client";

/* RecentRunsFeed — cross-agent "recent eval runs" table on the Eval Dashboard
   landing page. Each row: owning agent, timestamp, the run's PROMPT version
   token (bumps only when the system-prompt text changes; "—" for runs that
   predate prompt tracking), the three metrics as colored progress bars
   (recall=blue, precision=green, citation=amber — same convention as the
   agent cards and KPI cards), and a pass/total count (AC-8). Fixed to show 10
   visible rows via `overflowY: auto` + `maxHeight` (AC-9 — never pagination;
   the server already caps the fetched set to 25). Clicking a row navigates to
   the agent's detail page with `?batch=` so the detail page can pre-select /
   scroll to it (AC-10). */

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { EvalRecentBatchRow } from "@devdigest/shared";
import { pct, evalStyles as evalsTabStyles, TABLE_ROW_HEIGHT_PX } from "@/components/eval";
import { s } from "./styles";

// Visible row count before scroll kicks in (AC-9 — 10 visible + scroll, not
// pagination). Row height is sourced from the shared `td`/`table` style
// tokens (`TABLE_ROW_HEIGHT_PX`, `components/eval/styles.ts`) instead of a
// hand-tuned local literal, so the 10-visible-row viewport tracks the real
// row style rather than a guess that can drift from it.
const VISIBLE_ROWS = 10;
const ROW_HEIGHT_PX = TABLE_ROW_HEIGHT_PX;

/** A metric value rendered as a small colored progress bar + its percentage. */
function MetricBar({ value, color }: { value: number | null; color: string }) {
  return (
    <div style={s.metricCell}>
      <div style={s.barTrack}>
        <div style={{ ...s.barFill, width: `${Math.round((value ?? 0) * 100)}%`, background: color }} />
      </div>
      <span style={s.barPct}>{pct(value)}</span>
    </div>
  );
}

export function RecentRunsFeed({ rows }: { rows: EvalRecentBatchRow[] }) {
  const t = useTranslations("evals");
  const router = useRouter();

  const goToBatch = (row: EvalRecentBatchRow) => {
    router.push(`/evals/${row.agent_id}?batch=${row.batch.id}`);
  };

  return (
    <div>
      <div style={s.title}>
        <Icon.Clock size={13} />
        {t("feed.title")}
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("feed.empty")}</div>
      ) : (
        <div style={{ maxHeight: ROW_HEIGHT_PX * VISIBLE_ROWS, overflowY: "auto" }}>
          {/* No header row — mirrors the mockup, where the rows read on their
              own (agent · time · version · color-coded metric bars · pass). */}
          <table style={evalsTabStyles.table}>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.batch.id}
                  style={evalsTabStyles.batchRow}
                  onClick={() => goToBatch(row)}
                  data-testid={`recent-run-row-${row.batch.id}`}
                >
                  <td style={{ ...evalsTabStyles.td, fontWeight: 600 }}>{row.agent_name}</td>
                  <td style={{ ...evalsTabStyles.td, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                    {new Date(row.batch.ran_at).toLocaleString()}
                  </td>
                  <td style={{ ...evalsTabStyles.td }}>
                    <span style={s.versionToken}>{row.version != null ? `v${row.version}` : "—"}</span>
                  </td>
                  <td style={evalsTabStyles.td}>
                    <MetricBar value={row.batch.recall} color="var(--accent)" />
                  </td>
                  <td style={evalsTabStyles.td}>
                    <MetricBar value={row.batch.precision} color="var(--ok)" />
                  </td>
                  <td style={evalsTabStyles.td}>
                    <MetricBar value={row.batch.citation_accuracy} color="var(--warn)" />
                  </td>
                  <td style={{ ...evalsTabStyles.td, fontWeight: 700, whiteSpace: "nowrap" }}>
                    {row.pass_count}/{row.total_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
