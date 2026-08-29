/* EvalCaseEditor — the shared eval-case editor modal (SPEC-03).
   Three consumers: the agent `Evals` tab (T12), the finding card's "Turn
   into eval case" (T15), and the skill `Evals` tab (T19) via T20's
   `owner_kind` seam — see `helpers.ts` `getInputTabs` and `ActualOutputRegion`
   below for the two seams T20 extends.

   FIX-2 (REQ-56/57/59): the skill arm's `CodeInput` is CONTROLLED — its
   filename/before/after/kind state lives here (`codeSource`) so a
   skill-owned save has something to transmit (`skill-helpers.ts`
   `buildSkillInputFiles` → `helpers.ts` `buildEvalCaseWrite`'s
   `inputFiles`/`filename`). Before this fix `CodeInput` held that state
   itself with no way out — the write was a dead end.

   `@testing-library/user-event` is not a client/ dependency (verified this
   run) — this component and its test use `fireEvent`, matching every other
   `*.test.tsx` in the package. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, FormField, Icon, IconBtn, Modal, Textarea, TextInput, Toggle } from "@devdigest/ui";
import type { EvalCaseRecord, EvalCaseRunResult } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { formatCost } from "@/lib/format";
import { useCreateEvalCase, useDeleteEvalCase, useRunEvalCase, useUpdateEvalCase } from "@/lib/hooks/evals";
import { CodeInput } from "./_components/CodeInput";
import type { CodeInputValue } from "./_components/CodeInput";
import { ActualOutput } from "./_components/ActualOutput";
import { EMPTY_EXPECTED_OUTPUT_TEXT, MODAL_WIDTH, SKILL_MODAL_WIDTH } from "./constants";
import {
  appendFindingSkeleton,
  buildEvalCaseWrite,
  deriveExpectationKind,
  formatActualOutput,
  formatDurationSeconds,
  getInputTabs,
  isEvalCaseRecord,
  positiveBannerFinding,
  safeParseExpectedOutput,
} from "./helpers";
import { appendSkillFindingSkeleton, buildSkillInputFiles } from "./skill-helpers";
import { s } from "./styles";
import type { EvalCaseEditorProps, InputTabKey } from "./types";

/**
 * Renders the active Input tab's content — ONE component (T14's seam), not
 * three inlined `{activeTab === "x" && …}` blocks, so T20's `skill` arm
 * (Code/Preview tabs) is a body edit here, never a new call site.
 */
function InputTabContent({
  activeTab,
  diffValue,
  onDiffChange,
  diffPlaceholder,
}: {
  activeTab: InputTabKey;
  diffValue: string;
  onDiffChange: (v: string) => void;
  diffPlaceholder: string;
}) {
  switch (activeTab) {
    case "diff":
      return <Textarea mono rows={14} value={diffValue} onChange={onDiffChange} placeholder={diffPlaceholder} />;
    default:
      // Files/PR meta are disabled this wave (REQ-53/54) — nothing selects them.
      return null;
  }
}

/**
 * REQ-49: the latest run's actual output, formatted, or "Never run yet" —
 * ONE component (T14's other seam) for T20's skill-arm ablation view to
 * extend without a second call site.
 */
function ActualOutputRegion({ run, neverRunYetText }: { run: EvalCaseRunResult | null; neverRunYetText: string }) {
  const formatted = formatActualOutput(run);
  if (formatted === null) return <p style={s.actualOutputEmpty}>{neverRunYetText}</p>;
  return <pre style={s.actualOutputPre}>{formatted}</pre>;
}

/**
 * The run-result strip: verdict icon, "Last run passed/failed", then the tally
 * · duration · cost. ONE component for both arms — they render identical
 * markup and differ only in where the parent puts it (the agent arm leaves it
 * at the bottom of the scrolling body; the skill arm pins it above the footer,
 * which is what `skill` adjusts the margin for).
 */
function RunStrip({
  run,
  skill = false,
  t,
}: {
  run: EvalCaseRunResult;
  skill?: boolean;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  return (
    <div style={s.lastRunStrip(run.pass, skill)} role="status">
      {run.pass ? <Icon.CheckCircle size={15} aria-hidden="true" /> : <Icon.XCircle size={15} aria-hidden="true" />}
      <span style={s.lastRunLabel}>{run.pass ? t("lastRunPassed") : t("lastRunFailed")}</span>
      <span style={s.lastRunSeparator} aria-hidden="true">
        ·
      </span>
      {/* One case ran, so the tally is always out of 1 — `passed` is the case
          itself, not a metric. Recall/precision/citation are the DASHBOARD's
          job; this strip answers "did it pass, how long, how much". */}
      <span style={s.lastRunSummary}>
        {t("resultSummary", {
          passed: run.pass ? 1 : 0,
          total: 1,
          duration: formatDurationSeconds(run.duration_ms),
          cost: formatCost(run.cost_usd),
        })}
      </span>
    </div>
  );
}

export function EvalCaseEditor({ ownerKind, ownerId, initialCase, initialRun, onClose, onSaved }: EvalCaseEditorProps) {
  // `eval.json`'s case-editor copy is nested under `caseEditor`; the delete
  // label is reused from the (top-level) `evalsTab` section instead of a new key.
  const t = useTranslations("eval.caseEditor");
  const tEvalsTab = useTranslations("eval.evalsTab");
  const tCommon = useTranslations("common");
  const deleteLabel = tEvalsTab("delete");
  const fieldId = React.useId();

  /* The layout flag. The skill arm authors two code editors, reads an output
     pane and carries a bottom zone; the agent arm's single pasted diff never
     needed any of that and MUST NOT change — every style below that takes this
     argument returns its pre-redesign object when it is false, and the two
     elements that moved are rendered from an `ownerKind` branch. */
  const skill = ownerKind === "skill";

  const record = isEvalCaseRecord(initialCase) ? initialCase : null;
  const draft = initialCase && !isEvalCaseRecord(initialCase) ? initialCase : null;

  const [name, setName] = React.useState(record?.name ?? draft?.name ?? "");
  const [inputDiff, setInputDiff] = React.useState(record?.input_diff ?? draft?.input_diff ?? "");
  const [expectedOutputRaw, setExpectedOutputRaw] = React.useState(() => {
    const seed = record?.expected_output ?? draft?.expected_output ?? [];
    return seed.length ? JSON.stringify(seed, null, 2) : EMPTY_EXPECTED_OUTPUT_TEXT;
  });
  const [forbiddenRegions] = React.useState(record?.forbidden_regions ?? draft?.forbidden_regions ?? null);
  // FIX-2 (REQ-56/57/59): the skill arm's authored source, lifted up from
  // `CodeInput` (now controlled) so a skill-owned save has something to
  // transmit — `buildSkillInputFiles` (skill-helpers.ts) turns this into the
  // write payload's `input_files`.
  const [codeSource, setCodeSource] = React.useState<CodeInputValue>(() => {
    const src = record?.input_files ?? null;
    if (src?.kind === "modified_file") {
      return { kind: "modified_file", filename: src.filename, before: src.before, after: src.after };
    }
    if (src?.kind === "new_file") {
      return { kind: "new_file", filename: src.filename, before: "", after: src.after };
    }
    return { kind: "new_file", filename: record?.filename ?? "", before: "", after: "" };
  });
  const [activeTab, setActiveTab] = React.useState<InputTabKey>("diff");
  const [runOnSave, setRunOnSave] = React.useState(false);
  const [lastRun, setLastRun] = React.useState<EvalCaseRunResult | null>(initialRun ?? null);
  const [savedCaseId, setSavedCaseId] = React.useState<string | null>(record?.id ?? null);
  // The serialized write that was last persisted, or null before any save.
  // Compared against `payloadKey` below — see `isSaved`.
  const [savedPayload, setSavedPayload] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  /* REQ-60's disclosure, hoisted out of `CodeInput` so it can render at the
     BOTTOM of the popup (see the pinned zone below) instead of competing with
     the editors for the left pane's height. Pure UI, never part of a write. */
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const createCase = useCreateEvalCase();
  const updateCase = useUpdateEvalCase();
  const runCase = useRunEvalCase(ownerKind, ownerId);
  const deleteCase = useDeleteEvalCase(ownerKind, ownerId);

  const inputTabs = React.useMemo(() => getInputTabs(ownerKind), [ownerKind]);
  const parsed = safeParseExpectedOutput(expectedOutputRaw);
  const expectationKind = deriveExpectationKind(expectedOutputRaw);
  // Provenance of a seeded case (`reviews/eval-draft.ts`), carried through Save
  // and nothing else. It no longer drives the banner: the arms now differ in
  // SCORING (accepted → `must_find`, dismissed → `must_not_flag`), so
  // `expectationKind` labels them on its own and a seeded case and a
  // hand-authored one of the same kind read identically — which is correct,
  // because they are scored identically.
  const seededFrom = record?.seeded_from ?? draft?.seeded_from ?? null;
  const firstFinding = positiveBannerFinding(expectedOutputRaw);

  /* The write Save/Run case would send RIGHT NOW. Built at render rather than
     inside `persist` so `isSaved` can compare it against what was last
     persisted: that comparison is what makes the "Saved" note vanish the
     instant ANY field diverges, with no dirty flag wired into every onChange
     and no timer. Cheap — a plain object build over state already in hand. */
  const payload = buildEvalCaseWrite({
    ownerKind,
    ownerId,
    name,
    inputDiff,
    expectedOutput: parsed.ok ? parsed.value : [],
    forbiddenRegions,
    seededFrom,
    // FIX-2: only the skill arm carries input_files/filename — the agent
    // arm's payload stays exactly as before (helpers.ts omits the keys
    // entirely when these are left undefined).
    ...(skill
      ? { inputFiles: buildSkillInputFiles(codeSource), filename: codeSource.filename }
      : {}),
  });
  const payloadKey = JSON.stringify(payload);
  /* Save persists silently: the modal stays open by design (REQ-11 — the user
     stays put to see the run result), no call site passes `onSaved`, and with
     `Run on save` off nothing on screen changed, so the action read as a
     no-op. This is the confirmation, and it is state-based rather than
     event-based so it can never claim "saved" over edited-since content. */
  const isSaved = savedCaseId !== null && savedPayload === payloadKey;

  const saving = createCase.isPending || updateCase.isPending;
  const running = runCase.isPending;
  const canSubmit = name.trim().length > 0 && parsed.ok;

  function reportError(e: unknown) {
    setSaveError(e instanceof ApiError ? e.message : String(e));
  }

  /** Create-or-update, keyed off whether this editor already has a saved id.
   * Shared by both footer actions: "Save" persists (and, with `runOnSave`,
   * runs); "Run case" always persists first so it also works on a
   * brand-new, never-saved case (mockup 7/8: "New eval case" → Running…). */
  async function persist(): Promise<EvalCaseRecord> {
    const saved = savedCaseId
      ? await updateCase.mutateAsync({ id: savedCaseId, patch: payload })
      : await createCase.mutateAsync(payload);
    setSavedCaseId(saved.id);
    setSavedPayload(payloadKey);
    onSaved?.(saved);
    return saved;
  }

  async function handleSave() {
    if (!canSubmit) return;
    setSaveError(null);
    try {
      const saved = await persist();
      // REQ-11/50: with `Run on save` on, saving runs the case once — no
      // second action needed to see pass state, duration and cost.
      if (runOnSave) {
        const result = await runCase.mutateAsync(saved.id);
        setLastRun(result);
      }
    } catch (e) {
      reportError(e);
    }
  }

  async function handleRunCase() {
    if (!canSubmit) return;
    setSaveError(null);
    try {
      const saved = await persist();
      const result = await runCase.mutateAsync(saved.id);
      setLastRun(result);
    } catch (e) {
      reportError(e);
    }
  }

  async function handleDelete() {
    if (!savedCaseId) return;
    await deleteCase.mutateAsync(savedCaseId);
    setConfirmDelete(false);
    onClose();
  }

  const nameId = `${fieldId}-name`;

  return (
    <>
      <Modal
        width={skill ? SKILL_MODAL_WIDTH : MODAL_WIDTH}
        // Flips on `savedCaseId`, not `record` — a case this editor minted
        // itself IS saved, and retitling is the second, structural half of the
        // save confirmation. (Delete stays gated on `record`; see below.)
        title={savedCaseId ? t("caseTitle", { name: name.trim() || record?.name || "" }) : t("newCase")}
        // Mockup 7's header line. A draft carries the finding it was seeded
        // from (FindingCard's "Turn into eval case"); everything else is
        // authored from scratch against a pasted diff.
        subtitle={draft ? t("subtitleFromFinding") : t("subtitle")}
        onClose={onClose}
        footer={
          <div style={s.footer}>
            {/* Delete belongs to EDITING an existing case only. Gating this on
                `savedCaseId` made it appear mid-authoring the moment "Run case"
                persisted the draft — a destructive control the author never
                asked for, next to a case they have not finished writing.
                `record` is the create/edit discriminator (an id the editor
                minted itself is not "editing"). */}
            {record && <IconBtn icon="Trash" label={deleteLabel} onClick={() => setConfirmDelete(true)} />}
            <div style={s.runOnSaveRow}>
              <Toggle on={runOnSave} onChange={setRunOnSave} ariaLabel={t("runOnSave")} />
              <span>{t("runOnSave")}</span>
            </div>
            {/* A separate element, never a relabelling of the Save button —
                client/INSIGHTS.md 2026-08-29: extra text folded into a
                control's accessible name breaks exact-name `getByRole`. */}
            {isSaved && (
              <span role="status" style={s.savedNote}>
                <Icon.CheckCircle size={14} aria-hidden="true" />
                {t("saved")}
              </span>
            )}
            <div style={s.footerRight}>
              <Button kind="ghost" onClick={onClose}>
                {tCommon("actions.cancel")}
              </Button>
              {/* `loading` swaps the Play glyph for the kit's spinning
                  RefreshCw: a run is a seconds-long round trip, and the label
                  swap on its own read as a dead click. */}
              <Button
                kind="secondary"
                icon="Play"
                loading={running}
                onClick={handleRunCase}
                disabled={!canSubmit || saving || running}
              >
                {running ? t("running") : t("runCase")}
              </Button>
              <Button kind="primary" icon="Check" onClick={handleSave} disabled={!canSubmit || saving || running}>
                {saving ? t("saving") : t("save")}
              </Button>
            </div>
          </div>
        }
      >
        <div style={s.body}>
          <div style={s.columns}>
            {/* Mockup 7: the banner, Name and Input all live in the LEFT
                column; the right column is Expected output over Actual
                output. REQ-48's "full-width above Name" is the width of
                that column, and the banner still carries no control. */}
            <div style={s.colLeft}>
                  {/* Banner label comes from PROVENANCE when the case was seeded
                  from a finding (both arms are `must_not_flag`, so the scoring
                  kind cannot distinguish them), and from `expectationKind` for
                  a hand-authored case. Never a control (REQ-48). */}
              {expectationKind === "must_find" ? (
                <div style={s.bannerPositive}>
                  <span style={{ ...s.bannerLabel, ...s.bannerLabelPositive }}>{t("banner.positiveLabel")}</span>
                  <span style={s.bannerBody}>
                    {t("banner.positiveBody", {
                      title: firstFinding?.title ?? "",
                      file: firstFinding?.file ?? "",
                      line: firstFinding?.start_line ?? "",
                    })}
                  </span>
                </div>
              ) : (
                <div style={s.bannerNegative}>
                  <span style={{ ...s.bannerLabel, ...s.bannerLabelNegative }}>{t("banner.negativeLabel")}</span>
                  {/* Fixed string by owner request — it reads the same on every
                      negative case, seeded or hand-authored, and carries no
                      file/line. Only the POSITIVE body interpolates. */}
                  <span style={s.bannerBody}>{t("banner.negativeBody")}</span>
                </div>
              )}

              <FormField label={t("nameLabel")} htmlFor={nameId} required>
                <TextInput id={nameId} value={name} onChange={setName} placeholder={t("namePlaceholder")} />
              </FormField>

              {/* Agent arm keeps the error here, mid-column, exactly as before.
                  The skill arm's pane scrolls, so its copy moved to the pinned
                  zone below the columns where it cannot scroll out of view. */}
              {!skill && saveError && (
                <p role="alert" style={s.error(false)}>
                  {saveError}
                </p>
              )}

              {skill ? (
                <CodeInput value={codeSource} onChange={setCodeSource} />
              ) : (
                <FormField label={t("inputLabel")}>
                  <div role="tablist" aria-label={t("inputLabel")} style={s.tabList}>
                    {inputTabs.map((tab) => {
                      const label = t(tab.labelKey);
                      const reason = tab.disabledReasonKey ? t(tab.disabledReasonKey) : undefined;
                      const accessibleName = reason ? `${label} — ${reason}` : label;
                      return (
                        <button
                          key={tab.key}
                          type="button"
                          role="tab"
                          aria-selected={activeTab === tab.key}
                          aria-label={accessibleName}
                          title={reason}
                          disabled={tab.disabled}
                          onClick={() => setActiveTab(tab.key)}
                          style={s.tabButton(activeTab === tab.key, tab.disabled)}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <div style={s.diffBox}>
                    <InputTabContent
                      activeTab={activeTab}
                      diffValue={inputDiff}
                      onDiffChange={setInputDiff}
                      diffPlaceholder={t("diffPlaceholder")}
                    />
                  </div>
                </FormField>
              )}
            </div>

            <div style={s.colRight}>
              <FormField
                label={t("expectedOutput")}
                right={
                  <div style={s.expectedHeaderRight}>
                    <Badge color={parsed.ok ? "var(--ok)" : "var(--crit)"} bg={parsed.ok ? "var(--ok-bg)" : "var(--crit-bg)"}>
                      {parsed.ok ? t("validJson") : t("invalidJson")}
                    </Badge>
                    <Button
                      kind="ghost"
                      size="sm"
                      icon="Plus"
                      onClick={() =>
                        setExpectedOutputRaw(
                          // REQ-55: a skill case's skeleton carries no `file`
                          // key (`skill-helpers.ts`) — the agent branch is
                          // untouched, same call as before.
                          skill
                            ? appendSkillFindingSkeleton(expectedOutputRaw)
                            : appendFindingSkeleton(expectedOutputRaw),
                        )
                      }
                    >
                      {t("findingSkeleton")}
                    </Button>
                  </div>
                }
              >
                <Textarea mono rows={14} value={expectedOutputRaw} onChange={setExpectedOutputRaw} />
              </FormField>

              <div style={s.actualOutputWrap}>
                <div style={s.actualOutputLabel}>{t("actualOutputLabel")}</div>
                {skill ? (
                  <ActualOutput run={lastRun} neverRunYetText={t("neverRunYet")} />
                ) : (
                  <ActualOutputRegion run={lastRun} neverRunYetText={t("neverRunYet")} />
                )}
              </div>
            </div>
          </div>

          {/* Skill arm: error + verdict pinned between the panes and the
              footer. Agent arm: nothing renders here, and its strip stays
              below in the scrolling body exactly where it was. */}
          {skill && (
            <div style={s.bottomZone}>
              {saveError && (
                <p role="alert" style={s.error(true)}>
                  {saveError}
                </p>
              )}
              {lastRun && <RunStrip run={lastRun} skill t={t} />}

              {/* REQ-60: the case's STORED `input_diff`, verbatim — nothing
                  here builds a diff. It lives at the bottom of the popup
                  rather than under the editors: as a sibling of the editor
                  region it was painted over the Before box the moment that
                  region ran out of room, and its expanded `pre` had nowhere
                  to go. */}
              <button
                type="button"
                onClick={() => setPreviewOpen((v) => !v)}
                style={s.disclosureToggle}
                aria-expanded={previewOpen}
              >
                <Icon.ChevronRight size={13} aria-hidden="true" style={s.disclosureChevron(previewOpen)} />
                {t("codeInput.previewGeneratedDiff")}
              </button>
              {previewOpen && <pre style={s.diffPreview}>{inputDiff || t("codeInput.noDiffYet")}</pre>}
            </div>
          )}

          {!skill && lastRun && <RunStrip run={lastRun} t={t} />}
        </div>
      </Modal>

      {confirmDelete && (
        <Modal
          width={420}
          title={t("deleteConfirmTitle")}
          onClose={() => setConfirmDelete(false)}
          footer={
            <div style={s.footerRight}>
              <Button kind="ghost" onClick={() => setConfirmDelete(false)}>
                {tCommon("actions.cancel")}
              </Button>
              <Button kind="danger" icon="Trash" onClick={handleDelete} disabled={deleteCase.isPending}>
                {deleteLabel}
              </Button>
            </div>
          }
        >
          <p style={s.modalBody}>{name}</p>
        </Modal>
      )}
    </>
  );
}

export default EvalCaseEditor;
