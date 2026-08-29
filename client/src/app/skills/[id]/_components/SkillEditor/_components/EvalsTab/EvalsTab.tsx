/* EvalsTab — the skill editor's `Evals` tab (SPEC-03 T19).

   **Case list only** (owner decision, plan §1.2): `Run all evals` and
   `+ New eval case` in the header, `Run`/`Edit`/delete on every row, the
   REQ-8 line ("expected N finding(s), got M"). NO batch history, NO metric
   cards, NO deltas, NO alert banner, NO trend chart — those need a rendered
   batch/dashboard surface this task deliberately does not add.

   ROW ANATOMY (owner decision, 2026-08-29): the row now matches the agent
   tab's — status marker, name + MUST FIND / MUST NOT FLAG pill, result line,
   quiet severity·category metadata, action cluster — so the two tabs read the
   same. It is deliberately a SIBLING COPY, not an import from
   `agents/[id]/…/_components` (that would be an import-boundary breach) and
   not a promoted shared component (owner chose the copy, to keep the agent
   tab's suite out of this change's blast radius). What is genuinely shared
   already lives in `lib/eval-batch.ts`.

   Two things stay skill-specific and are NOT the agent's:
   - the result line carries the ablation suffix (`With skill X% / Without
     skill Y%`) — the with/without arms are the whole point of a skill eval,
     and the agent tab has no equivalent;
   - deleting asks through the kit's `Modal`, not `window.confirm`, which is
     invisible to the Browser pane (client/INSIGHTS.md 2026-08-29).

   The list renders the SERVER's own order verbatim (REQ-51: `name` asc,
   `id` asc) — no client-side sort or grouping.

   `+ New eval case` and every row's `Edit` open T14's shared
   `components/eval-case-editor` in skill mode (`ownerKind="skill"`). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, IconBtn, Modal, Skeleton, SEV, CAT } from "@devdigest/ui";
import type { EvalExpectationKind, EvalOwnerKind, Skill } from "@devdigest/shared";
import { EvalCaseEditor } from "@/components/eval-case-editor";
import { ApiError } from "@/lib/api";
import {
  useDeleteEvalCase,
  useEvalBatch,
  useEvalBatches,
  useEvalCases,
  useRunEvalCase,
  useStartEvalBatch,
  type EvalCaseListItem,
} from "@/lib/hooks/evals";
import { batchCaseStates, formatBatchFraction, isBatchNonTerminal } from "@/lib/eval-batch";
import { useToast } from "@/lib/toast";
import {
  ablationPercents,
  caseRunMarker,
  expectationKindOf,
  isEmptyCase,
  passingSummary,
  runRecallPercent,
  skillFindingCount,
  type CaseRunMarker,
} from "./helpers";
import { s } from "./styles";

const OWNER_KIND: EvalOwnerKind = "skill";

type EditorState = { mode: "new" } | { mode: "edit"; item: EvalCaseListItem };

/** The case's stored `severity` / `category`, as quiet right-hand metadata.
   A `must_not_flag` case renders none — it stores no finding to read a pair
   from, and the `ExpectationPill` on its name line is what identifies it
   (AC-46). */
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
   than left to be inferred from the presence or absence of severity metadata.
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
   pass/fail icon beside a case being re-run reads as the result of the run in
   flight. A run whose `pass` is `null` (contractually possible, e.g. an
   errored run) reads as "never run" rather than a third invented state. */
function CaseMarker({
  marker,
  running,
  queued,
  labels,
}: {
  marker: CaseRunMarker;
  running: boolean;
  queued: boolean;
  labels: { passed: string; failed: string; neverRun: string; running: string; queued: string };
}) {
  if (running) {
    return (
      <span style={s.marker("var(--accent)")} aria-label={labels.running} role="img">
        <Icon.RefreshCw size={16} style={s.spin} />
      </span>
    );
  }
  if (queued) {
    return (
      <span style={s.marker("var(--text-muted)")} aria-label={labels.queued} role="img">
        <Icon.Clock size={16} />
      </span>
    );
  }
  if (marker === "pass") {
    return (
      <span style={s.marker("var(--ok)")} aria-label={labels.passed} role="img">
        <Icon.CheckCircle size={16} />
      </span>
    );
  }
  if (marker === "fail") {
    return (
      <span style={s.marker("var(--crit)")} aria-label={labels.failed} role="img">
        <Icon.XCircle size={16} />
      </span>
    );
  }
  return (
    <span style={s.marker("var(--text-muted)")} aria-label={labels.neverRun} role="img">
      <Icon.Dot size={16} />
    </span>
  );
}

export function EvalsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("eval.evalsTab");
  const tCase = useTranslations("eval.caseEditor");
  const tCommon = useTranslations("common");
  const toast = useToast();

  const { data: cases, isLoading, isError, refetch } = useEvalCases(OWNER_KIND, skill.id);
  const runCase = useRunEvalCase(OWNER_KIND, skill.id);
  const deleteCase = useDeleteEvalCase(OWNER_KIND, skill.id);
  const startBatch = useStartEvalBatch();
  const batchesQuery = useEvalBatches(OWNER_KIND, skill.id);

  const [startedBatchId, setStartedBatchId] = React.useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
  const [editorState, setEditorState] = React.useState<EditorState | null>(null);

  // Same shape as the agent tab: the batch being watched is the one this
  // session started, or — on a fresh mount — the newest still-running row in
  // the history, and the poll's own status is the single source of truth for
  // "is it still going" (nothing to reset with an effect).
  //
  // Both live ABOVE the `isLoading`/`isError` early returns below and must stay
  // there: `useEvalBatch` is a `useQuery`, so calling it past a conditional
  // return makes the loading→loaded transition render MORE hooks than the one
  // before it, and React throws. The bug hides behind a warm query cache — a
  // cached mount never renders the loading branch — so it only shows on a cold
  // load of this tab.
  const historyRunningId = batchesQuery.data?.find((b) => b.status === "running")?.id ?? null;
  const activeBatch = useEvalBatch(startedBatchId ?? historyRunningId);

  function reportError(e: unknown) {
    toast.error(e instanceof ApiError ? e.message : String(e));
  }

  // No local "which one is running" state: `useRunEvalCase` reports EVERY
  // in-flight run through `runningIds` (one `useMutation` observer only ever
  // tracks its latest call — see that hook), so several cases can be started
  // at once and each row reads its own state. `mutateAsync` still rejects for
  // the call it was made for even after a later click detaches the observer,
  // so this catch keeps reporting the right failure.
  async function handleRun(caseId: string) {
    try {
      await runCase.mutateAsync(caseId);
    } catch (e) {
      reportError(e);
    }
  }

  async function handleDelete() {
    if (!confirmDeleteId) return;
    try {
      await deleteCase.mutateAsync(confirmDeleteId);
      setConfirmDeleteId(null);
    } catch (e) {
      reportError(e);
    }
  }

  async function handleRunAll() {
    try {
      const res = await startBatch.mutateAsync({ owner_kind: OWNER_KIND, owner_id: skill.id });
      setStartedBatchId(res.batch_id);
    } catch (e) {
      reportError(e);
    }
  }

  if (isLoading) {
    return (
      <div style={s.wrap}>
        <div style={s.loadingHeader}>
          <Skeleton height={20} width={160} />
        </div>
        <Skeleton height={56} />
        <Skeleton height={56} />
      </div>
    );
  }
  if (isError) {
    return (
      <div style={s.wrap}>
        <ErrorState body={t("loadError")} onRetry={() => refetch()} />
      </div>
    );
  }

  const list = cases ?? [];
  const noCases = list.length === 0;
  // SPEC-03 amendment (2026-08-29): a skill eval batch no longer runs under a
  // linked agent — it runs under a fixed neutral reviewer prompt and a
  // workspace-configurable model, so a skill with no linked agent (or only
  // disabled ones) is an ordinary runnable state. The only remaining disabled
  // reasons are an empty case set (AC-15) and an in-flight batch.
  const batchRunning = activeBatch.data
    ? isBatchNonTerminal(activeBatch.data.status)
    : !!(startedBatchId ?? historyRunningId);
  const runningIds = new Set(runCase.runningIds);
  // The server runs a batch through a pool of EVAL_BATCH_CONCURRENCY workers,
  // so at most that many rows say "Running…" at once and the rest say
  // "Queued" — the same helper, and the same imported bound, the agent tab
  // uses. Nothing here caps anything on its own.
  const batchStates = batchCaseStates(list.map((c) => c.id), activeBatch.data, batchRunning);
  const { passed, total } = passingSummary(list);

  const runAllReason = noCases ? t("noCasesReason") : batchRunning ? t("inFlightReason") : null;
  const runAllDisabled = runAllReason !== null || startBatch.isPending;
  const runAllLabel = batchRunning ? t("running") : t("runAllEvals");
  const runAllAccessibleName = runAllReason ? `${runAllLabel} — ${runAllReason}` : runAllLabel;
  const newCaseLabel = `+ ${tCase("newCase")}`;
  const unmeasured = t("ablationUnmeasured");

  const labels = {
    passed: t("passed"),
    failed: t("failed"),
    neverRun: t("neverRun"),
    running: t("running"),
    queued: t("queued"),
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>
          {t("casesHeading")} {passed}/{total} {t("passingSuffix")}
        </h2>
        <div style={s.headerActions}>
          <Button
            kind="secondary"
            icon="Zap"
            onClick={handleRunAll}
            disabled={runAllDisabled}
            loading={startBatch.isPending || batchRunning}
            title={runAllReason ?? undefined}
            aria-label={runAllAccessibleName}
          >
            {runAllLabel}
          </Button>
          <Button kind="primary" icon="Plus" onClick={() => setEditorState({ mode: "new" })}>
            {newCaseLabel}
          </Button>
        </div>
      </div>

      {batchRunning && (
        <p role="status" aria-live="polite" style={s.progress}>
          {t("running")} {formatBatchFraction(activeBatch.data, list.length)}
        </p>
      )}

      {noCases ? (
        <EmptyState
          icon="FlaskConical"
          title={t("emptyCases")}
          cta={newCaseLabel}
          onCta={() => setEditorState({ mode: "new" })}
        />
      ) : (
        <ul style={s.list}>
          {list.map((item) => {
            const run = item.latest_run;
            const batchState = batchStates.get(item.id) ?? null;
            const running = runningIds.has(item.id) || batchState === "running";
            const queued = batchState === "queued";
            const busyLabel = running ? labels.running : queued ? labels.queued : null;
            // REQ-8: the expected count is the case's own `expected_output`;
            // the "got" count is the WITH arm's findings — a skill run stores
            // `{with, without}` in `actual_output`, never a bare array.
            // Then ` · recall X%` when the run recorded one (a `must_not_flag`
            // case records none), and the ablation pair when the without arm
            // ran — a single-case run leaves it `not_run`, so only a batch
            // fills both halves in.
            const recall = runRecallPercent(run);
            const ablation = ablationPercents(run);
            const resultLine = !run
              ? labels.neverRun
              : t("resultCount", { n: item.expected_output.length, m: skillFindingCount(run) }) +
                (recall == null ? "" : t("recallSuffix", { recall })) +
                (ablation == null
                  ? ""
                  : t("ablationSuffix", {
                      withPct: ablation.with == null ? unmeasured : `${ablation.with}%`,
                      withoutPct: ablation.without == null ? unmeasured : `${ablation.without}%`,
                    }));
            return (
              <li key={item.id} style={s.row}>
                <CaseMarker marker={caseRunMarker(item)} running={running} queued={queued} labels={labels} />
                <div style={s.rowBody}>
                  <span style={s.nameLine}>
                    <span style={s.name}>{item.name}</span>
                    <ExpectationPill
                      kind={expectationKindOf(item)}
                      mustFindLabel={t("mustFindBadge")}
                      mustNotFlagLabel={t("mustNotFlagBadge")}
                    />
                  </span>
                  <span style={s.resultLine}>{resultLine}</span>
                </div>
                <span style={s.spacer} />
                <CaseSeverityMeta item={item} />
                <div style={s.rowActions}>
                  {/* Only THIS row's state disables it: a run started on
                      another row leaves every other Run clickable. `queued`
                      is a case a batch has not reached yet — a still `Clock`,
                      not a spinner, because the server's pool has no live call
                      for it. WCAG 2.5.3 Label in Name: the accessible name is
                      built from the label the button is ACTUALLY rendering,
                      never a fixed `Run`. */}
                  <Button
                    kind="ghost"
                    size="sm"
                    icon={queued ? "Clock" : "Play"}
                    onClick={() => handleRun(item.id)}
                    disabled={queued}
                    loading={running}
                    aria-label={`${busyLabel ?? t("run")} — ${item.name}`}
                  >
                    {busyLabel ?? t("run")}
                  </Button>
                  <Button
                    kind="ghost"
                    size="sm"
                    icon="Edit"
                    onClick={() => setEditorState({ mode: "edit", item })}
                  >
                    {t("edit")}
                  </Button>
                  <IconBtn
                    icon="Trash"
                    label={t("delete")}
                    onClick={() => setConfirmDeleteId(item.id)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {confirmDeleteId && (
        <Modal
          width={420}
          title={t("deleteConfirmTitle")}
          onClose={() => setConfirmDeleteId(null)}
          footer={
            <div style={s.modalFooter}>
              <Button kind="ghost" onClick={() => setConfirmDeleteId(null)}>
                {tCommon("actions.cancel")}
              </Button>
              <Button
                kind="danger"
                icon="Trash"
                onClick={handleDelete}
                disabled={deleteCase.isPending}
              >
                {t("delete")}
              </Button>
            </div>
          }
        >
          <p style={s.modalBody}>{list.find((c) => c.id === confirmDeleteId)?.name}</p>
        </Modal>
      )}

      {editorState && (
        <EvalCaseEditor
          ownerKind={OWNER_KIND}
          ownerId={skill.id}
          initialCase={editorState.mode === "edit" ? editorState.item : null}
          initialRun={editorState.mode === "edit" ? editorState.item.latest_run : null}
          onClose={() => setEditorState(null)}
        />
      )}
    </div>
  );
}
