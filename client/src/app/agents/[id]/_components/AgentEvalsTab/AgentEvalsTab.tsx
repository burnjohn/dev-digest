/* AgentEvalsTab — A4 default-export for the Agent Editor "Evals" tab.
   Lists eval cases for the agent (EvalCaseRow), an inline mini-dashboard, and
   links to the full Eval Case Editor. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import {
  useEvalCases,
  useRunEvalCase,
  useDeleteEvalCase,
  type EvalCaseFilter,
} from "../../../../../lib/hooks/eval";
import { EvalDashboard } from "../../../../eval/_components/EvalDashboard";
import { EvalCaseRow, type EvalCaseWithLast } from "./_components/EvalCaseRow";
import { s } from "./styles";

export function AgentEvalsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const router = useRouter();
  const filter: EvalCaseFilter = { ownerKind: "agent", ownerId: agentId };
  const { data: cases, isLoading } = useEvalCases(filter);
  const run = useRunEvalCase();
  const del = useDeleteEvalCase();

  const open = (caseId: string) => router.push(`/agents/${agentId}/evals/${caseId}`);

  return (
    <div style={s.root}>
      <EvalDashboard
        filter={filter}
        title={t("evalsTab.metricsTitle")}
        subtitle={t("evalsTab.metricsSubtitle")}
        compact
      />

      <div>
        <div style={s.casesHead}>
          <h3 style={s.casesTitle}>{t("evalsTab.casesHeading")}</h3>
          <div style={s.newCaseWrap}>
            <Button kind="primary" size="sm" icon="Plus" onClick={() => open("new")}>
              {t("evalsTab.newCase")}
            </Button>
          </div>
        </div>
        {isLoading ? (
          <div style={s.loading}>{t("evalsTab.loadingCases")}</div>
        ) : (cases ?? []).length === 0 ? (
          <div style={s.empty}>{t("evalsTab.emptyCases")}</div>
        ) : (
          (cases as EvalCaseWithLast[]).map((ec) => (
            <EvalCaseRow
              key={ec.id}
              ec={ec}
              running={run.isPending}
              onOpen={() => open(ec.id)}
              onRun={() => run.mutate(ec.id)}
              onDelete={() => del.mutate(ec.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default AgentEvalsTab;
