/* CiRuns — A4 CI Runs view (ported from ScreenCIRuns in screen_cizruns.jsx).
   Ingests from the GitHub Actions API on load (local-first polling) and lists
   automated reviews executed inside CI. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Chip, EmptyState, Icon } from "@devdigest/ui";
import type { CiRun } from "@devdigest/shared/contracts/eval-ci";
import { useCiRuns, useIngestCiRuns } from "../../../../lib/hooks/ci";
import { COLS, STATUS } from "./constants";
import { s } from "./styles";

export function CiRunsView() {
  const t = useTranslations("ci");
  const { data: runs, isLoading } = useCiRuns();
  const ingest = useIngestCiRuns();

  const list = runs ?? [];

  if (!isLoading && list.length === 0) {
    return (
      <div style={s.emptyWrap}>
        <EmptyState icon="Workflow" title={t("runs.emptyTitle")} body={t("runs.emptyBody")} />
      </div>
    );
  }

  return (
    <div>
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>{t("runs.title")}</h1>
          <p style={s.subtitle}>{t("runs.subtitle")}</p>
        </div>
        <div style={s.headerActions}>
          <span style={s.autoRefresh}>
            <span style={s.autoDot} />
            {t("runs.autoRefresh")}
          </span>
          <Button kind="secondary" size="sm" icon="RefreshCw" onClick={() => ingest.mutate()}>
            {ingest.isPending ? t("runs.refreshing") : t("runs.refresh")}
          </Button>
        </div>
      </div>

      <div style={s.chips}>
        <Chip icon="Calendar">{t("runs.filters.last7Days")}</Chip>
        <Chip icon="Cpu">{t("runs.filters.allAgents")}</Chip>
        <Chip icon="GitBranch">{t("runs.filters.allRepos")}</Chip>
        <Chip active>{t("runs.filters.allStatuses")}</Chip>
      </div>

      <div style={s.tableWrap}>
        <div style={s.headRow(COLS)}>
          {[
            t("runs.table.timestamp"),
            t("runs.table.pullRequest"),
            t("runs.table.source"),
            t("runs.table.findings"),
            t("runs.table.cost"),
            t("runs.table.status"),
            "",
          ].map((c, i) => (
            <div key={i}>{c}</div>
          ))}
        </div>
        {list.map((r: CiRun, i) => {
          const st = STATUS[r.status ?? "running"] ?? STATUS.running!;
          return (
            <div key={r.id} style={s.row(COLS, i === list.length - 1)}>
              <span className="mono" style={s.ranAt}>
                {r.ran_at ? new Date(r.ran_at).toLocaleString() : "—"}
              </span>
              <div style={s.prCell}>
                <span className="mono" style={s.prNumber}>
                  {r.pr_number != null ? `#${r.pr_number}` : "—"}
                </span>{" "}
                <span style={s.agent}>{r.agent ?? ""}</span>
              </div>
              <Badge color="var(--text-secondary)" icon="Workflow">
                {r.source ?? "—"}
              </Badge>
              <span className="tnum" style={s.findings}>
                {r.findings_count != null ? r.findings_count : "—"}
              </span>
              <span className="mono tnum" style={s.cost}>
                {r.cost_usd != null ? `$${r.cost_usd.toFixed(2)}` : "—"}
              </span>
              <Badge color={st.c} bg={st.bg} dot>
                {t(st.labelKey)}
              </Badge>
              <span>
                {r.github_url ? (
                  <a href={r.github_url} target="_blank" rel="noreferrer" style={s.viewLink}>
                    <Icon.ExternalLink size={13} style={s.viewIcon} /> {t("runs.view")}
                  </a>
                ) : (
                  <span style={s.dash}>—</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default CiRunsView;
