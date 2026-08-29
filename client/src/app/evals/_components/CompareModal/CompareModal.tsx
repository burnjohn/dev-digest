/* CompareModal — REQ-34/35/36/71: exactly-two-batches comparison. Four delta
   cards in RECALL, PRECISION, CITATION, COST order, then the version-diff
   region (T3 widened `Modal` for the Escape/focus-trap/`aria-labelledby`
   behaviour this composes rather than reimplements).

   2026-08-29 — `Promote vN` SHIPS, reversing SPEC-03's non-goal §3 on the
   owner's decision. The objection recorded there ("promoting an older snapshot
   would write a new, higher version rather than rewind") is now the chosen
   semantics, matching `POST /skills/:id/restore`, which has behaved that way
   since it shipped. `POST /agents/:id/restore` was added to give the agent half
   the same write path.

   FIX-2: the "Compare" title word and the same-version statement now live at
   `eval.compareModal.*`. Every other label below is a real key, several borrowed
   from sibling namespaces (`skills:preview.version` for "vN",
   `runs:trace.stat.cost` for the COST card) rather than re-declared. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, Modal, Skeleton, ErrorState } from "@devdigest/ui";
import { ErrorBoundary } from "@/components/error-boundary";
import { useEvalBatchComparison } from "@/lib/hooks/evals";
import { useAgent, useRestoreAgentVersion } from "@/lib/hooks/agents";
import { useRestoreSkillVersion, useSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import type { EvalMetricDelta, EvalPromptDiffLine } from "@devdigest/shared";
import {
  formatCost,
  formatPercent,
  formatSignedCost,
  formatSignedPercentDelta,
} from "../../_lib/format";
import { numberDiffLines } from "./helpers";
import { s } from "./styles";

function deltaColor(value: number | null, invert: boolean): string {
  if (value === null || value === 0) return "var(--text-muted)";
  const rising = value > 0;
  const good = invert ? !rising : rising;
  return good ? "var(--ok)" : "var(--crit)";
}

function DeltaCard({
  label,
  delta,
  invert = false,
  format,
  formatSigned,
}: {
  label: string;
  delta: EvalMetricDelta;
  invert?: boolean;
  format: (v: number | null) => string;
  formatSigned: (v: number | null) => string;
}) {
  return (
    <div style={s.deltaCard}>
      <span style={s.deltaLabel}>{label}</span>
      {/* old → new AND the signed delta on ONE line — the delta on its own row
          made every tile three rows tall and read as a stray number. */}
      <div style={s.deltaValues}>
        <span style={s.deltaOld}>{format(delta.old)}</span>
        <span style={s.deltaArrow}>→</span>
        <span className="tnum" style={s.deltaNew}>
          {format(delta.new)}
        </span>
        <span style={s.deltaSep}>/</span>
        <span className="tnum" style={{ ...s.deltaSigned, color: deltaColor(delta.delta, invert) }}>
          {formatSigned(delta.delta)}
        </span>
      </div>
    </div>
  );
}

const DIFF_MARKER: Record<EvalPromptDiffLine["op"], string> = { same: " ", add: "+", del: "-" };

function DiffLine({ line, number }: { line: EvalPromptDiffLine; number: number }) {
  const rowStyle =
    line.op === "add" ? s.diffLineAdd : line.op === "del" ? s.diffLineDel : s.diffLineSame;
  return (
    <div className="mono" style={{ ...s.diffLine, ...rowStyle }}>
      <span className="tnum" style={s.diffGutter}>
        {number}
      </span>
      <span style={s.diffMarker}>{DIFF_MARKER[line.op]}</span>
      <span>{line.text}</span>
    </div>
  );
}

interface CompareModalProps {
  batchA: string;
  batchB: string;
  onClose: () => void;
}

export function CompareModal({ batchA, batchB, onClose }: CompareModalProps) {
  const t = useTranslations("eval");
  const tCommon = useTranslations("common");
  const tSkills = useTranslations("skills");
  const tRuns = useTranslations("runs");
  const tAgents = useTranslations("agents");
  const toast = useToast();
  const { data, isLoading, isError, refetch } = useEvalBatchComparison(batchA, batchB);
  const [confirming, setConfirming] = React.useState(false);

  // The version the promote TARGETS, and the owner's version right now. Both are
  // needed to report the outcome honestly: a restore whose config already
  // matches is a server-side no-op that still answers 200 with the unchanged
  // entity, and the only way to tell that from a real promote is to know what
  // the version was before the call. Comparing the response to the TARGET is not
  // enough — promoting v20 twice leaves v21 current, so the second call would
  // come back as 21 and read as a success that never happened.
  const ownerKind = data?.newer.owner_kind ?? null;
  const ownerId = data?.newer.owner_id ?? null;
  const target = data?.newer.owner_version ?? null;
  // Both hooks run every render; the one for the other owner kind is passed null
  // and stays `enabled: false`, so it never issues a request.
  const agent = useAgent(ownerKind === "agent" ? ownerId : null);
  const skill = useSkill(ownerKind === "skill" ? ownerId : null);
  const restoreAgent = useRestoreAgentVersion();
  const restoreSkill = useRestoreSkillVersion();

  const currentVersion = ownerKind === "agent" ? agent.data?.version : skill.data?.version;
  const isPromoting = restoreAgent.isPending || restoreSkill.isPending;

  const promote = async () => {
    if (ownerKind === null || ownerId === null || target === null) return;
    try {
      const saved =
        ownerKind === "agent"
          ? await restoreAgent.mutateAsync({ id: ownerId, version: target })
          : await restoreSkill.mutateAsync({ id: ownerId, version: target });
      setConfirming(false);
      if (currentVersion !== undefined && saved.version === currentVersion) {
        toast.info(t("compareModal.promote.noop"));
        return;
      }
      toast.success(t("compareModal.promote.success", { from: target, version: saved.version }));
    } catch {
      // `mutateAsync` REJECTS on a failed write, unlike `mutate`. Left unhandled
      // it is an unhandled rejection and the footer stays stuck in its confirm
      // state with no explanation.
      setConfirming(false);
      toast.error(t("compareModal.promote.error"));
    }
  };

  const closeButton = (
    <Button kind="secondary" onClick={onClose}>
      {tCommon("actions.close")}
    </Button>
  );

  if (isLoading || !data) {
    return (
      <Modal
        title={t("compareModal.title")}
        onClose={onClose}
        footer={<div style={s.footer}>{closeButton}</div>}
      >
        <div style={s.loading}>
          <Skeleton height={80} />
          <Skeleton height={160} />
        </div>
      </Modal>
    );
  }

  if (isError) {
    return (
      <Modal
        title={t("compareModal.title")}
        onClose={onClose}
        footer={<div style={s.footer}>{closeButton}</div>}
      >
        <ErrorState body={tCommon("states.error")} onRetry={() => refetch()} />
      </Modal>
    );
  }

  const olderVersion = tSkills("preview.version", { version: data.older.owner_version });
  const newerVersion = tSkills("preview.version", { version: data.newer.owner_version });

  const title = (
    <>
      {t("compareModal.title")} · {olderVersion} {"→"} {newerVersion}
    </>
  );

  // Confirmation in the footer, not a nested `Modal` — see styles.ts `confirmRow`.
  const footer = confirming ? (
    <div style={s.confirmRow}>
      <span style={s.confirmText}>{t("compareModal.promote.body")}</span>
      <Button kind="ghost" onClick={() => setConfirming(false)} disabled={isPromoting}>
        {tCommon("actions.cancel")}
      </Button>
      <Button kind="primary" icon="History" onClick={promote} loading={isPromoting}>
        {t("compareModal.promote.confirm")}
      </Button>
    </div>
  ) : (
    <div style={s.footer}>
      {closeButton}
      <Button
        kind="primary"
        icon="History"
        onClick={() => setConfirming(true)}
        disabled={data.same_version}
        title={data.same_version ? t("compareModal.promote.sameVersionDisabled") : undefined}
      >
        {t("compareModal.promote.action", { version: data.newer.owner_version })}
      </Button>
    </div>
  );

  const errorFallback = (reset: () => void) => (
    <ErrorState body={tCommon("states.error")} onRetry={reset} />
  );

  const diff = data.prompt_diff === null ? null : numberDiffLines(data.prompt_diff);

  return (
    <Modal
      title={title}
      subtitle={t("compareModal.subtitle")}
      onClose={onClose}
      footer={footer}
      width={980}
    >
      <ErrorBoundary fallback={errorFallback} resetKeys={[batchA, batchB]}>
        <div style={s.body}>
          <div style={s.deltaGrid}>
            <DeltaCard
              label={t("dashboard.metrics.recall")}
              delta={data.recall}
              format={formatPercent}
              formatSigned={formatSignedPercentDelta}
            />
            <DeltaCard
              label={t("dashboard.metrics.precision")}
              delta={data.precision}
              format={formatPercent}
              formatSigned={formatSignedPercentDelta}
            />
            <DeltaCard
              label={t("compareModal.citation")}
              delta={data.citation_accuracy}
              format={formatPercent}
              formatSigned={formatSignedPercentDelta}
            />
            <DeltaCard
              label={tRuns("trace.stat.cost")}
              delta={data.cost_usd}
              invert
              format={formatCost}
              formatSigned={formatSignedCost}
            />
          </div>

          <div style={s.diffSection}>
            <div style={s.diffHeader}>
              <span style={s.diffHeading}>
                <Icon.FileText size={13} aria-hidden />
                {tAgents("config.systemPrompt")} {t("compareModal.diffLabel")}
              </span>
              {!data.same_version && (
                <div style={s.legend}>
                  <span style={s.legendItem}>
                    <span style={{ ...s.legendDot, background: "var(--crit)" }} />
                    {olderVersion} ({t("compareModal.legendOld")})
                  </span>
                  <span style={s.legendItem}>
                    <span style={{ ...s.legendDot, background: "var(--ok)" }} />
                    {newerVersion} ({t("compareModal.legendNew")})
                  </span>
                </div>
              )}
            </div>
            {data.same_version || diff === null ? (
              <p style={s.sameVersion}>
                {/* AC-36: never an empty diff pane for a same-version comparison. */}
                {t("compareModal.sameVersion")}
              </p>
            ) : (
              <div style={s.diffBox}>
                {diff.rows.length > 0 && (
                  <div className="mono" style={s.hunkHeader}>
                    {diff.hunkHeader}
                  </div>
                )}
                {diff.rows.map((row, i) => (
                  <DiffLine key={i} line={row.line} number={row.number} />
                ))}
              </div>
            )}
          </div>
        </div>
      </ErrorBoundary>
    </Modal>
  );
}
