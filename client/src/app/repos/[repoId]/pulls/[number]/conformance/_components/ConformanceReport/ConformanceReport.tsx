/* ConformanceReport — A4 PRD↔PR Conformance (3-column, ported from
   ScreenConformance in screen_conv_conf.jsx). Implemented ✅ / Missing ⚠️ /
   Scope creep ➕ + completeness score. Default-export; mounts in PR detail and
   the standalone /repos/:repoId/pulls/:number/conformance page. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, CircularScore, EmptyState } from "@devdigest/ui";
import { useConformance, useRunConformance } from "../../../../../../../../lib/hooks/conformance";
import { Column } from "./_components/Column";
import { COLUMN_COLORS, COLUMN_ICONS } from "./constants";
import { partitionItems } from "./helpers";
import { s } from "./styles";

export function ConformanceReport({
  prId,
  prNumber,
  spec,
}: {
  prId: string;
  prNumber?: number;
  spec?: string;
}) {
  const t = useTranslations("conformance");
  const { data, isLoading } = useConformance(prId, spec);
  const run = useRunConformance();

  const report = (run.data ?? data)?.report;

  if (isLoading) {
    return <div style={s.loading}>{t("report.loading")}</div>;
  }

  if (!report) {
    return (
      <div style={s.emptyWrap}>
        <EmptyState icon="ListChecks" title={t("report.emptyTitle")} body={t("report.emptyBody")} />
        <div style={s.emptyAction}>
          <Button kind="primary" icon="ListChecks" onClick={() => run.mutate({ prId, input: spec ? { spec } : {} })}>
            {run.isPending ? t("report.runningCheck") : t("report.runCheck")}
          </Button>
        </div>
        {run.isError && <p style={s.emptyError}>{(run.error as Error).message}</p>}
      </div>
    );
  }

  const { implemented, missing, creep } = partitionItems(report.items);

  return (
    <div style={s.root}>
      <div style={s.header}>
        <div style={s.headerMain}>
          <h2 style={s.h2}>{t("report.prdTitle", { title: report.spec_title })}</h2>
          <p style={s.comparing}>
            {t.rich("report.comparing", {
              prNumber: prNumber != null ? `#${prNumber}` : "",
              specId: report.spec_id,
              pr: (chunks) => (
                <span className="mono" style={s.prNumber}>
                  {chunks}
                </span>
              ),
              spec: (chunks) => (
                <span className="mono">{chunks}</span>
              ),
            })}
          </p>
        </div>
        <div style={s.scoreWrap}>
          <CircularScore score={report.completeness_pct} size={60} stroke={6} />
          <span style={s.scoreLabel}>{t("report.complete")}</span>
        </div>
        <Button
          kind="secondary"
          size="sm"
          icon="RefreshCw"
          onClick={() => run.mutate({ prId, input: spec ? { spec } : {} })}
        >
          {run.isPending ? t("report.reRunning") : t("report.reRunCheck")}
        </Button>
      </div>

      <div style={s.columns}>
        <Column
          icon={COLUMN_ICONS.implemented}
          label={t("report.columns.implemented")}
          color={COLUMN_COLORS.implemented}
          items={implemented}
          noneLabel={t("report.none")}
        />
        <Column
          icon={COLUMN_ICONS.missing}
          label={t("report.columns.missing")}
          color={COLUMN_COLORS.missing}
          items={missing}
          noneLabel={t("report.none")}
        />
        <Column
          icon={COLUMN_ICONS.scopeCreep}
          label={t("report.columns.scopeCreep")}
          color={COLUMN_COLORS.scopeCreep}
          items={creep}
          noneLabel={t("report.none")}
        />
      </div>
    </div>
  );
}

export default ConformanceReport;
