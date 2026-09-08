"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, SectionLabel } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import type { EvalCase, EvalCaseOutcome } from "@devdigest/shared/contracts/knowledge";
import { CaseEditorPanel, CaseList } from "@/components/eval-case-editor";
import {
  useDeleteEvalCase,
  useSkillEvalCarriers,
  useSkillEvalCases,
  useSkillEvalRun,
  useSkillEvalRuns,
} from "@/lib/hooks/eval";
import { useSkillPreview } from "@/lib/hooks/skills";
import { NewSkillCaseModal } from "./NewSkillCaseModal";
import { RunSkillEvalModal } from "./RunSkillEvalModal";
import { SkillCompareModal } from "./SkillCompareModal";
import { SkillMetricTiles } from "./SkillMetricTiles";
import { SkillRunHistory } from "./SkillRunHistory";
import { effectByCaseId, originByCaseId, outcomesByCaseId } from "./helpers";
import { s } from "./styles";

/**
 * specs/15-skill-eval-cases.md AC-34 … AC-38, AC-47, AC-48 — the skill
 * editor's Evals tab: metric tiles (with lift, effect counts, token cost)
 * from the latest completed run, the case list (with origin + effect,
 * AC-35), the run history, and the run/new-case modals. Mirrors the shipped
 * agent tab's `activeRunId` + `aria-live` polling shape (AC-48's status
 * announcement) — see `AgentEditor/.../EvalsTab/EvalsTab.tsx:42-62,101-103`.
 */
export function EvalsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("eval");
  const { data: cases, isLoading: casesLoading } = useSkillEvalCases(skill.id);
  const { data: runs } = useSkillEvalRuns(skill.id);
  const { data: carriers } = useSkillEvalCarriers(skill.id);
  const { data: preview } = useSkillPreview(skill.id);
  const deleteCase = useDeleteEvalCase();

  const [openCaseId, setOpenCaseId] = React.useState<string | null>(null);
  const [activeRunId, setActiveRunId] = React.useState<string | null>(null);
  const [showRunModal, setShowRunModal] = React.useState(false);
  const [showNewCaseModal, setShowNewCaseModal] = React.useState(false);
  const [compareIds, setCompareIds] = React.useState<[string, string] | null>(null);

  const latestRun = runs?.[0] ?? null;
  const latestCompleted = React.useMemo(() => runs?.find((r) => r.status === "completed") ?? null, [runs]);

  // A run already in flight when this tab mounted is picked up so the
  // aria-live region still reflects reality, not just runs THIS session started.
  React.useEffect(() => {
    if (latestRun?.status === "running" && activeRunId == null) setActiveRunId(latestRun.id);
  }, [latestRun, activeRunId]);

  const { data: polledRun } = useSkillEvalRun(activeRunId);
  const isRunning = polledRun ? polledRun.status === "running" : activeRunId != null;

  React.useEffect(() => {
    if (activeRunId && polledRun && polledRun.status !== "running") setActiveRunId(null);
  }, [activeRunId, polledRun]);

  const outcomes = React.useMemo(() => outcomesByCaseId(latestCompleted), [latestCompleted]);
  const withoutOutcomes = React.useMemo(() => {
    const map = new Map<string, EvalCaseOutcome>();
    for (const o of latestCompleted?.arm_without?.per_case ?? []) map.set(o.case_id, o);
    return map;
  }, [latestCompleted]);
  const origins = React.useMemo(() => originByCaseId(cases), [cases]);
  const effects = React.useMemo(() => effectByCaseId(latestCompleted), [latestCompleted]);

  const hasCases = !!cases && cases.length > 0;
  const openCase: EvalCase | null = openCaseId ? (cases?.find((c) => c.id === openCaseId) ?? null) : null;

  const handleDelete = (evalCase: EvalCase) => {
    if (typeof window !== "undefined" && !window.confirm(t("evalsTab.deleteConfirm"))) return;
    deleteCase.mutate({ id: evalCase.id, ownerId: evalCase.owner_id });
  };

  return (
    <div style={s.wrap}>
      <div>
        <div style={s.header}>
          <h2 style={s.h2}>{t("evalsTab.metricsTitle")}</h2>
          <div style={s.headSpacer}>
            <Button
              kind="primary"
              size="sm"
              icon="Play"
              onClick={() => setShowRunModal(true)}
              disabled={isRunning || !hasCases}
              loading={isRunning}
            >
              {isRunning ? t("evalsTab.running") : t("dashboard.runEval", { count: cases?.length ?? 0 })}
            </Button>
          </div>
        </div>
        <p style={s.hint}>{t("skill.metricsSubtitle")}</p>
        <div
          role="status"
          aria-live="polite"
          style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}
        >
          {activeRunId ? t("evalsTab.runStatus", { status: polledRun ? t(`status.${polledRun.status}`) : t("status.running") }) : ""}
        </div>
      </div>

      {!hasCases ? (
        casesLoading ? null : <SkillMetricTiles run={null} tokensPerRun={preview?.tokens ?? null} />
      ) : !latestCompleted ? (
        <>
          <SkillMetricTiles run={null} tokensPerRun={preview?.tokens ?? null} />
          <p style={s.hint}>{t("skill.empty.neverRun")}</p>
        </>
      ) : (
        <SkillMetricTiles run={latestCompleted} tokensPerRun={preview?.tokens ?? null} />
      )}

      <div style={s.section}>
        <div style={s.sectionHead}>
          <SectionLabel icon="ListChecks">{t("evalsTab.casesHeading")}</SectionLabel>
          <div style={s.headSpacer}>
            <Button kind="secondary" size="sm" icon="Plus" onClick={() => setShowNewCaseModal(true)}>
              {t("caseEditor.newCase")}
            </Button>
          </div>
        </div>
        <CaseList
          cases={cases}
          isLoading={casesLoading}
          outcomesByCaseId={outcomes}
          runDisabled={isRunning || !carriers || carriers.length === 0}
          onOpen={setOpenCaseId}
          onRun={() => setShowRunModal(true)}
          onDelete={handleDelete}
          originByCaseId={origins}
          effectByCaseId={effects}
          emptyBody={t("skill.empty.noCases")}
        />
      </div>

      <div style={s.section}>
        <SectionLabel icon="History">{t("dashboard.recentRuns")}</SectionLabel>
        <SkillRunHistory runs={runs} onCompare={(a, b) => setCompareIds([a, b])} />
      </div>

      {openCase && (
        <CaseEditorPanel
          caseId={openCase.id}
          outcome={outcomes.get(openCase.id) ?? null}
          withoutOutcome={latestCompleted ? (withoutOutcomes.get(openCase.id) ?? null) : undefined}
          onClose={() => setOpenCaseId(null)}
        />
      )}

      {showRunModal && (
        <RunSkillEvalModal
          skill={skill}
          carriers={carriers ?? []}
          onClose={() => setShowRunModal(false)}
          onStarted={(runId) => setActiveRunId(runId)}
        />
      )}

      {showNewCaseModal && <NewSkillCaseModal skill={skill} onClose={() => setShowNewCaseModal(false)} />}

      {compareIds && <SkillCompareModal a={compareIds[0]} b={compareIds[1]} onClose={() => setCompareIds(null)} />}
    </div>
  );
}
