/* EvalsTab — the agent editor's `Evals` tab (SPEC-03, T12): the EVAL METRICS
   row (REQ-25/AC-30, four figures — recall/precision/citation from the
   latest TERMINAL batch, plus `TRACES PASSED n/m`, `—` for every unmeasured
   one) and the case list (REQ-7/8/9, server order verbatim, `Run`/`Edit`/
   delete per row, `Run all evals` + `+ New eval case` in the header).

   This tab is one of `EvalCaseEditor`'s three consumers (T14) — `+ New eval
   case` and every row's `Edit` open the SAME shared modal, imported from
   `components/eval-case-editor`, never copied.

   `Run all evals` polling (AC-17): the batch id being watched is either the
   one this session just started, or — on a fresh mount while a batch happens
   to already be running — the newest `"running"` row in `useEvalBatches`'
   history. Either way, `useEvalBatch(id)`'s own returned `status` is the
   single source of truth for "is it still running", so there is nothing to
   reset with an effect: once the poll returns a terminal status, `Run all
   evals` re-enables on the next render, no state transition needed. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  IconBtn,
  SectionLabel,
  Skeleton,
  SEV,
  CAT,
} from "@devdigest/ui";
import type { Agent, EvalExpectationKind } from "@devdigest/shared";
import { EvalCaseEditor } from "@/components/eval-case-editor";
import {
  useEvalBatch,
  useEvalBatches,
  useEvalCases,
  useEvalOwnerDashboard,
  useRunEvalCase,
  useDeleteEvalCase,
  useStartEvalBatch,
  type EvalCaseListItem,
} from "@/lib/hooks/evals";
import { batchCaseStates, formatBatchFraction, isBatchNonTerminal } from "@/lib/eval-batch";
import {
  actualFindingCount,
  caseRunMarker,
  expectationKindOf,
  formatMetricPercent,
  formatTracesPassed,
  isEmptyCase,
  passingSummary,
  runAllDisabledReason,
  runRecallPercent,
} from "./helpers";
import { s } from "./styles";

type EditorTarget = { case: EvalCaseListItem | null };

/** The case's stored `severity` / `category`, as quiet right-hand metadata.
   A `must_not_flag` case renders none — it stores no finding to read a pair
   from, and the `ExpectationPill` on its name line is what identifies it
   (AC-46; that row used to carry a literal `empty []` badge, which the pill
   made redundant). */
function CaseSeverityMeta({ item }: { item: EvalCaseListItem }) {
  if (isEmptyCase(item)) return null;
  const first = item.expected_output[0]!;
  const sev = SEV[first.severity];
  const cat = CAT[first.category];
  return (
    <span style={s.severityMeta}>
      {sev.label.toUpperCase()} · {cat?.label ?? first.category}
    </span>
  );
}

/** AC-46/AC-48: what the case ASSERTS, stated in words beside its name rather
   than left to be inferred from the presence or absence of a severity badge.
   Deliberately the same two claims the editor's banner makes ("MUST find …" /
   "MUST NOT flag"), so a row and its open editor never read differently.
   Text-only — no glyph — so the two arms are told apart by their words, with
   colour (blue / green) as reinforcement rather than as the sole signal. */
function ExpectationPill({
  kind,
  mustFindLabel,
  mustNotFlagLabel,
}: {
  kind: EvalExpectationKind;
  mustFindLabel: string;
  mustNotFlagLabel: string;
}) {
  const isFind = kind === "must_find";
  return (
    <span
      style={
        isFind
          ? s.expectationPill("var(--accent-text)", "var(--accent-bg)")
          : s.expectationPill("var(--ok)", "var(--ok-bg)")
      }
    >
      {isFind ? mustFindLabel : mustNotFlagLabel}
    </span>
  );
}

/** While THIS case is running — or waiting its turn in a batch — the marker
   column shows the live state instead of the previous run's verdict: a stale
   pass/fail icon beside a case that is being re-run reads as the result of
   the run in flight. */
function CaseMarker({
  marker,
  running,
  queued,
  runningLabel,
  queuedLabel,
  passedLabel,
  failedLabel,
  neverRunLabel,
}: {
  marker: "pass" | "fail" | "never";
  running: boolean;
  queued: boolean;
  runningLabel: string;
  queuedLabel: string;
  passedLabel: string;
  failedLabel: string;
  neverRunLabel: string;
}) {
  if (running) {
    return (
      <span style={s.marker("var(--accent)")} aria-label={runningLabel} role="img">
        <Icon.RefreshCw size={16} style={s.spin} />
      </span>
    );
  }
  if (queued) {
    return (
      <span style={s.marker("var(--text-muted)")} aria-label={queuedLabel} role="img">
        <Icon.Clock size={16} />
      </span>
    );
  }
  if (marker === "pass") {
    return (
      <span style={s.marker("var(--ok)")} aria-label={passedLabel} role="img">
        <Icon.CheckCircle size={16} />
      </span>
    );
  }
  if (marker === "fail") {
    return (
      <span style={s.marker("var(--crit)")} aria-label={failedLabel} role="img">
        <Icon.XCircle size={16} />
      </span>
    );
  }
  return (
    <span style={s.marker("var(--text-muted)")} aria-label={neverRunLabel} role="img">
      <Icon.Dot size={16} />
    </span>
  );
}

function CaseRow({
  item,
  marker,
  resultLine,
  passedLabel,
  failedLabel,
  neverRunLabel,
  runLabel,
  runningLabel,
  queuedLabel,
  editLabel,
  deleteLabel,
  mustFindLabel,
  mustNotFlagLabel,
  onEdit,
  onRun,
  running,
  queued,
  onDelete,
  deleting,
}: {
  item: EvalCaseListItem;
  marker: "pass" | "fail" | "never";
  resultLine: string;
  passedLabel: string;
  failedLabel: string;
  neverRunLabel: string;
  runLabel: string;
  runningLabel: string;
  queuedLabel: string;
  editLabel: string;
  deleteLabel: string;
  mustFindLabel: string;
  mustNotFlagLabel: string;
  onEdit: () => void;
  onRun: () => void;
  running: boolean;
  queued: boolean;
  onDelete: () => void;
  deleting: boolean;
}) {
  const busyLabel = running ? runningLabel : queued ? queuedLabel : null;
  return (
    <li style={s.row}>
      <CaseMarker
        marker={marker}
        running={running}
        queued={queued}
        runningLabel={runningLabel}
        queuedLabel={queuedLabel}
        passedLabel={passedLabel}
        failedLabel={failedLabel}
        neverRunLabel={neverRunLabel}
      />
      <div style={s.rowBody}>
        <span style={s.nameLine}>
          <span style={s.name}>{item.name}</span>
          <ExpectationPill
            kind={expectationKindOf(item)}
            mustFindLabel={mustFindLabel}
            mustNotFlagLabel={mustNotFlagLabel}
          />
        </span>
        <span style={s.resultLine}>{resultLine}</span>
      </div>
      <span style={s.spacer} />
      <CaseSeverityMeta item={item} />
      <div style={s.rowActions}>
        {/* WCAG 2.5.3 Label in Name: each accessible name STARTS with the
            visible text and only then disambiguates by case name. */}
        {/* Three states, and ONLY this row's own: `loading` makes the click
            visible (the kit swaps `Play` for a spinning `RefreshCw` and
            disables the button) while `Queued` is a still `Clock` for a case
            a batch has not reached yet. A run is a seconds-long round trip,
            and the old disabled-but-unchanged button read as a dead click.
            Sibling rows stay live — single-case runs are independent requests
            and `useRunEvalCase` reports all of them through `runningIds`, so
            several can be started at once and each spins on its own row. The
            accessible name is built from the label the button is ACTUALLY
            rendering (never a fixed `Run`), so WCAG 2.5.3 still holds while
            it says `Running…`. */}
        <Button
          kind="ghost"
          size="sm"
          icon={queued ? "Clock" : "Play"}
          loading={running}
          aria-label={`${busyLabel ?? runLabel} — ${item.name}`}
          onClick={onRun}
          disabled={queued}
        >
          {busyLabel ?? runLabel}
        </Button>
        <Button kind="ghost" size="sm" icon="Edit" aria-label={`${editLabel} — ${item.name}`} onClick={onEdit}>
          {editLabel}
        </Button>
        <IconBtn icon="Trash" label={`${deleteLabel} — ${item.name}`} onClick={onDelete} disabled={deleting} danger />
      </div>
    </li>
  );
}

export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("eval.evalsTab");
  const tDash = useTranslations("eval.dashboard");
  const tCommon = useTranslations("common");

  const casesQuery = useEvalCases("agent", agent.id);
  const dashQuery = useEvalOwnerDashboard(agent.id);
  const batchesQuery = useEvalBatches("agent", agent.id);
  const startBatch = useStartEvalBatch();
  const runCase = useRunEvalCase("agent", agent.id);
  const deleteCase = useDeleteEvalCase("agent", agent.id);

  const [startedBatchId, setStartedBatchId] = React.useState<string | null>(null);
  const [editorTarget, setEditorTarget] = React.useState<EditorTarget | null>(null);

  const historyRunningId = batchesQuery.data?.find((b) => b.status === "running")?.id ?? null;
  const trackedBatchId = startedBatchId ?? historyRunningId;
  const activeBatch = useEvalBatch(trackedBatchId);
  // Optimistic while the first poll of a just-started/just-found batch hasn't
  // landed yet; `activeBatch.data.status` is authoritative once it has.
  const batchRunning = activeBatch.data ? isBatchNonTerminal(activeBatch.data.status) : !!trackedBatchId;

  async function handleRunAll() {
    const res = await startBatch.mutateAsync({ owner_kind: "agent", owner_id: agent.id });
    setStartedBatchId(res.batch_id);
  }

  if (casesQuery.isError || dashQuery.isError) {
    return (
      <div style={s.wrap}>
        <ErrorState
          body={tCommon("states.error")}
          onRetry={() => {
            casesQuery.refetch();
            dashQuery.refetch();
          }}
        />
      </div>
    );
  }

  if (!casesQuery.data || !dashQuery.data) {
    return (
      <div style={s.wrap}>
        <Skeleton height={90} />
        <div style={{ marginTop: 16 }}>
          <Skeleton height={40} />
          <Skeleton height={40} />
          <Skeleton height={40} />
        </div>
      </div>
    );
  }

  const cases = casesQuery.data;
  const dash = dashQuery.data;
  // Two independent sources of "this row is busy": the single-case runs the
  // user started here (several may be in flight at once — `runningIds`, not
  // `isPending`, see `useRunEvalCase`), and the one case a running BATCH has
  // reached, with every case after it queued behind it.
  const manualRunIds = new Set(runCase.runningIds);
  const batchStates = batchCaseStates(
    cases.map((c) => c.id),
    activeBatch.data,
    batchRunning,
  );
  const { passed, total } = passingSummary(cases);
  const disabledReason = runAllDisabledReason(cases.length, batchRunning, {
    emptySetReason: t("emptySetReason"),
    inFlightReason: t("inFlightReason"),
  });
  const runAllLabel = batchRunning ? t("running") : t("runAllEvals");
  const runLabel = t("run");
  const runningLabel = t("running");
  const queuedLabel = t("queued");
  const editLabel = t("edit");
  const deleteLabel = t("delete");
  const neverRunLabel = t("neverRun");
  const passedLabel = t("passed");
  const failedLabel = t("failed");
  const mustFindLabel = t("mustFindBadge");
  const mustNotFlagLabel = t("mustNotFlagBadge");

  return (
    <div style={s.wrap}>
      <div style={s.section}>
        <div style={s.metricsHeader}>
          <SectionLabel icon="Gauge">{t("metricsTitle")}</SectionLabel>
        </div>
        <p style={s.metricsSubtitle}>{t("metricsSubtitle")}</p>
        <div style={s.metricGrid}>
          <div style={s.metricCard}>
            <span style={s.metricLabel}>{tDash("metrics.recall")}</span>
            <span className="tnum" style={s.metricValue}>
              {formatMetricPercent(dash.latest_batch?.recall)}
            </span>
          </div>
          <div style={s.metricCard}>
            <span style={s.metricLabel}>{tDash("metrics.precision")}</span>
            <span className="tnum" style={s.metricValue}>
              {formatMetricPercent(dash.latest_batch?.precision)}
            </span>
          </div>
          <div style={s.metricCard}>
            <span style={s.metricLabel}>{tDash("metrics.citationAccuracy")}</span>
            <span className="tnum" style={s.metricValue}>
              {formatMetricPercent(dash.latest_batch?.citation_accuracy)}
            </span>
          </div>
          <div style={s.metricCard}>
            <span style={s.metricLabel}>{t("tracesPassedLabel")}</span>
            <span className="tnum" style={s.metricValue}>
              {formatTracesPassed(dash.latest_batch)}
            </span>
          </div>
        </div>
        <Link href={`/evals/${agent.id}`} style={s.dashboardLink}>
          {t("viewFullDashboard")}
        </Link>
      </div>

      <div style={s.section}>
        <div style={s.headerRow}>
          <h2 style={s.h2}>
            {t("casesHeading")} {passed}/{total} {t("passingSuffix")}
          </h2>
          <div style={s.headerActions}>
            <Button
              kind="secondary"
              icon="Play"
              loading={batchRunning || startBatch.isPending}
              disabled={!!disabledReason || startBatch.isPending}
              title={disabledReason ?? undefined}
              // WCAG 2.5.3 Label in Name: the accessible name must CONTAIN the
              // visible text, so it is built from the same `runAllLabel` the
              // button renders, never a fixed "Run all evals" that could drift
              // from a "Running…" label.
              aria-label={disabledReason ? `${runAllLabel} — ${disabledReason}` : undefined}
              onClick={handleRunAll}
            >
              {runAllLabel}
            </Button>
            <Button kind="primary" icon="Plus" onClick={() => setEditorTarget({ case: null })}>
              {t("newCase")}
            </Button>
          </div>
        </div>

        {batchRunning && (
          <p role="status" aria-live="polite" style={s.progress}>
            {t("running")} {formatBatchFraction(activeBatch.data, cases.length)}
          </p>
        )}

        {cases.length === 0 ? (
          <EmptyState icon="FlaskConical" title={t("emptyCases")} />
        ) : (
          <ul style={s.list}>
            {cases.map((item) => {
              const marker = caseRunMarker(item);
              // `expected <n> finding(s), got <m>`, plus ` · recall <p>%` when
              // the run recorded a recall — a `must_not_flag` case records
              // none, so its line ends after `got <m>`.
              const recall = runRecallPercent(item.latest_run);
              const resultLine =
                marker === "never"
                  ? neverRunLabel
                  : t("resultCount", { n: item.expected_output.length, m: actualFindingCount(item.latest_run) }) +
                    (recall == null ? "" : t("recallSuffix", { recall }));
              return (
                <CaseRow
                  key={item.id}
                  item={item}
                  marker={marker}
                  resultLine={resultLine}
                  passedLabel={passedLabel}
                  failedLabel={failedLabel}
                  neverRunLabel={neverRunLabel}
                  runLabel={runLabel}
                  runningLabel={runningLabel}
                  queuedLabel={queuedLabel}
                  editLabel={editLabel}
                  deleteLabel={deleteLabel}
                  mustFindLabel={mustFindLabel}
                  mustNotFlagLabel={mustNotFlagLabel}
                  onEdit={() => setEditorTarget({ case: item })}
                  onRun={() => runCase.mutate(item.id)}
                  running={manualRunIds.has(item.id) || batchStates.get(item.id) === "running"}
                  queued={batchStates.get(item.id) === "queued"}
                  onDelete={() => {
                    if (window.confirm(`${t("deleteConfirmPrefix")} "${item.name}"${t("deleteConfirmSuffix")}`)) {
                      deleteCase.mutate(item.id);
                    }
                  }}
                  deleting={deleteCase.isPending && deleteCase.variables === item.id}
                />
              );
            })}
          </ul>
        )}
      </div>

      {editorTarget && (
        <EvalCaseEditor
          ownerKind="agent"
          ownerId={agent.id}
          initialCase={editorTarget.case}
          initialRun={editorTarget.case?.latest_run ?? null}
          onClose={() => setEditorTarget(null)}
        />
      )}
    </div>
  );
}
