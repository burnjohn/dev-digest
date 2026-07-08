"use client";

/* CaseEditor — source-aware, two-panel modal for authoring / editing an eval
   case (B7 redesign). Left = Input (Diff / Files / PR-meta tabs) + Name/Notes;
   right = Expected output rendered as a finding-skeleton over the existing
   `Expectation[]` model (no JSON parser — the structured rows stay the source
   of truth; the JSON block is a read-only view mirroring the review agent's
   own Finding shape). Header/subtitle + NEGATIVE-CASE banner derive from the
   case's provenance (accepted finding → must_find; dismissed → must_not_flag).

   The authoritative diff validation is server-side (`parseUnifiedDiff` at save
   time); this component only does a trivial non-empty pre-check and surfaces
   the server's error inline on save failure without closing. */

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Button, Textarea, TextInput, SelectInput, Badge, Tabs, Toggle } from "@devdigest/ui";
import type { Expectation, EvalCaseListItem } from "@devdigest/shared";
import { useCreateEvalCase, useUpdateEvalCase } from "@/lib/hooks/eval";
import { ApiError } from "@/lib/api";
import { DiffViewer, rawDiffToPrFiles } from "@/components/diff-viewer";

interface CaseEditorProps {
  agentId: string;
  /** Owning agent's display name — used in the manual-case subtitle. */
  agentName?: string;
  /** When set, pre-fills the form for editing an existing case in place —
      save calls the update mutation (PATCH) with this case's id instead of
      creating a new case. */
  initialCase?: EvalCaseListItem | null;
  onClose: () => void;
  /** Parent (EvalsTab) owns run orchestration (202 + poll). The editor calls
      this to fire a single-case run — on demand ("Run case") or after a save
      when "Run on save" is on. Absent → run affordances are hidden. */
  onRunCase?: (caseId: string) => void;
  /** A batch is already running — disables the in-editor Run case button. */
  runDisabled?: boolean;
}

interface DraftExpectation extends Expectation {
  key: string;
}

let keySeq = 0;
function nextKey() {
  keySeq += 1;
  return `exp-${keySeq}`;
}

function emptyExpectation(type: Expectation["type"] = "must_find"): DraftExpectation {
  const base: DraftExpectation = { key: nextKey(), type, file: "", line_start: 1, line_end: 1 };
  // must_find skeletons mirror a Finding out of the box (severity/category are
  // display metadata — AC-24 — so scoring ignores them either way).
  if (type === "must_find") {
    base.severity = "WARNING";
    base.category = "bug";
  }
  return base;
}

/** File paths referenced by a unified diff — feeds the read-only "Files" tab
    (derived client-side; `input_files` is not populated server-side). */
function filesFromDiff(diff: string): string[] {
  const out = new Set<string>();
  for (const line of diff.split("\n")) {
    const plus = line.match(/^\+\+\+ [ab]\/(.+?)\s*$/);
    if (plus && plus[1] && plus[1] !== "/dev/null") {
      out.add(plus[1]);
      continue;
    }
    const git = line.match(/^diff --git a\/.+? b\/(.+?)\s*$/);
    if (git && git[1]) out.add(git[1]);
  }
  return Array.from(out);
}

/** The finding-skeleton view: must_find expectations rendered as the Finding
    shape the review agent emits (severity/category/title/file/start_line).
    must_not_flag-only / empty → `[]` (assert-empty). No matching semantics —
    scoring still runs on the structured Expectation[] (file + line overlap).
    Unset severity/category are OMITTED (not defaulted) so this view matches the
    Select's "—" state instead of inventing a value. */
function skeletonJson(exps: Expectation[], title: string): string {
  const finds = exps.filter((e) => e.type === "must_find" && e.file.trim());
  if (finds.length === 0) return "[]";
  return JSON.stringify(
    finds.map((e) => {
      const finding: Record<string, unknown> = {};
      if (e.severity) finding.severity = e.severity;
      if (e.category) finding.category = e.category;
      finding.title = title || "…";
      finding.file = e.file;
      finding.start_line = e.line_start;
      return finding;
    }),
    null,
    2,
  );
}

const st = {
  body: { padding: 0, display: "grid", gridTemplateColumns: "1fr 1fr", minHeight: 380 } as React.CSSProperties,
  panel: { padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 } as React.CSSProperties,
  panelLeft: { borderRight: "1px solid var(--border)" } as React.CSSProperties,
  fieldLabel: { fontSize: 12, color: "var(--text-muted)" } as React.CSSProperties,
  smallLabel: { fontSize: 11, color: "var(--text-muted)" } as React.CSSProperties,
  sectionLabel: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } as React.CSSProperties,
  code: {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: 12,
    whiteSpace: "pre-wrap",
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "10px 12px",
    color: "var(--text-secondary)",
    margin: 0,
  } as React.CSSProperties,
  metaGrid: { display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", fontSize: 12.5 } as React.CSSProperties,
  metaKey: { color: "var(--text-muted)" } as React.CSSProperties,
  expCard: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "10px 12px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-surface)",
  } as React.CSSProperties,
} as const;

export function CaseEditor({ agentId, agentName, initialCase, onClose, onRunCase, runDisabled }: CaseEditorProps) {
  const t = useTranslations("agents");
  const createCase = useCreateEvalCase(agentId);
  const updateCase = useUpdateEvalCase(agentId);
  const isEditing = !!initialCase;
  const activeMutation = isEditing ? updateCase : createCase;

  const [name, setName] = React.useState(initialCase?.name ?? "");
  const [diff, setDiff] = React.useState(initialCase?.input_diff ?? "");
  const [notes, setNotes] = React.useState(initialCase?.notes ?? "");
  // #10 — an existing zero-expectation case (a deliberate "clean diff" case,
  // AC-9) must stay empty when edited. Branch on `initialCase` presence, NOT
  // `expected_output.length`, so a real empty case isn't given a phantom row.
  const [expectations, setExpectations] = React.useState<DraftExpectation[]>(
    initialCase
      ? initialCase.expected_output.map((e) => ({ ...e, key: nextKey() }))
      : [emptyExpectation()],
  );
  const [activeTab, setActiveTab] = React.useState("diff");
  const [runOnSave, setRunOnSave] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const updateExpectation = (key: string, patch: Partial<Expectation>) => {
    setExpectations((prev) => prev.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  };
  const removeExpectation = (key: string) => {
    setExpectations((prev) => prev.filter((e) => e.key !== key));
  };

  const handleSave = () => {
    setError(null);
    // Best-effort client-side pre-check only — server is authoritative (AC-8).
    if (!diff.trim()) {
      setError(t("evals.editor.diffRequired"));
      return;
    }
    // Drop leftover blank rows so an unfilled expectation doesn't fail the
    // server's `file: z.string().min(1)` with a confusing 400.
    const cleanExpectations: Expectation[] = expectations
      .filter((e) => e.file.trim().length > 0)
      .map(({ key, ...e }) => {
        void key;
        return e;
      });

    const input = {
      owner_id: agentId,
      name,
      input_diff: diff,
      expected_output: cleanExpectations,
      notes: notes || null,
    };

    const mutationOptions = {
      onSuccess: (saved?: EvalCaseListItem) => {
        const id = saved?.id ?? initialCase?.id ?? null;
        if (runOnSave && onRunCase && id) onRunCase(id);
        onClose();
      },
      onError: (err: unknown) => {
        setError(err instanceof ApiError ? err.message : String(err));
      },
    };

    if (initialCase) {
      updateCase.mutate({ caseId: initialCase.id, input }, mutationOptions);
    } else {
      createCase.mutate(input, mutationOptions);
    }
  };

  const handleRunCase = () => {
    if (!initialCase || !onRunCase) return;
    onRunCase(initialCase.id);
    onClose();
  };

  // ---- Derived, provenance-aware presentation -----------------------------
  const source = initialCase?.source ?? "manual";
  const hasMustFind = expectations.some((e) => e.type === "must_find");
  const hasMustNotFlag = expectations.some((e) => e.type === "must_not_flag");
  const pureNegative = hasMustNotFlag && !hasMustFind;
  const agentLabel = agentName?.trim() || t("evals.editor.agentFallback");

  const title = name.trim() ? `${t("evals.editor.titlePrefix")} · ${name}` : t("evals.editor.titleNew");
  const subtitle =
    source === "finding"
      ? pureNegative
        ? t("evals.editor.subtitleDismissed")
        : t("evals.editor.subtitleAccepted")
      : t("evals.editor.subtitleManual", { agent: agentLabel });

  const negExp = expectations.find((e) => e.type === "must_not_flag");
  const negLocation = negExp
    ? `${negExp.file || "?"}:${negExp.line_start}${name.trim() ? ` (${name})` : ""}`
    : "";

  const files = filesFromDiff(diff);
  const skeleton = skeletonJson(expectations, name);
  const assertEmpty = !hasMustFind;

  const lr = initialCase;
  const showLastRun = !!lr && lr.last_run_status !== "never_run";
  let lastRunText = "";
  let lastRunColorVar = "--text-secondary";
  if (showLastRun && lr) {
    const statusWord = t(`evals.status.${lr.last_run_status}`).toLowerCase();
    const parts: string[] = [];
    if (lr.last_run_summary) parts.push(lr.last_run_summary);
    if (lr.last_run_duration_ms != null) parts.push(`${(lr.last_run_duration_ms / 1000).toFixed(1)}s`);
    if (lr.last_run_cost_usd != null) parts.push(`$${lr.last_run_cost_usd.toFixed(2)}`);
    lastRunText = `${t("evals.editor.lastRun")} ${statusWord}${parts.length ? ` · ${parts.join(" · ")}` : ""}`;
    lastRunColorVar =
      lr.last_run_status === "passed" ? "--ok" : lr.last_run_status === "flaked" ? "--warn" : "--crit";
  }

  const tabs = [
    { key: "diff", label: t("evals.editor.tabDiff") },
    { key: "files", label: t("evals.editor.tabFiles"), count: files.length },
    { key: "prMeta", label: t("evals.editor.tabPrMeta") },
  ];

  const unset = t("evals.editor.prMetaNone");
  const severityOptions = [
    { value: "", label: unset },
    { value: "CRITICAL", label: "CRITICAL" },
    { value: "WARNING", label: "WARNING" },
    { value: "SUGGESTION", label: "SUGGESTION" },
  ];
  const categoryOptions = [
    { value: "", label: unset },
    { value: "bug", label: "bug" },
    { value: "security", label: "security" },
    { value: "perf", label: "perf" },
    { value: "style", label: "style" },
    { value: "test", label: "test" },
  ];

  return (
    <Modal
      width={900}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {/* Not a <label>: wrapping the Toggle button in a label re-dispatches
              the click to it (same class of bug as B1's SelectInput). */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Toggle on={runOnSave} onChange={setRunOnSave} size={16} />
            <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{t("evals.editor.runOnSave")}</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button kind="ghost" size="sm" onClick={onClose}>
              {t("evals.editor.cancel")}
            </Button>
            {initialCase && onRunCase && (
              <Button kind="secondary" size="sm" icon="Play" onClick={handleRunCase} disabled={runDisabled}>
                {t("evals.editor.runCase")}
              </Button>
            )}
            <Button kind="primary" size="sm" onClick={handleSave} loading={activeMutation.isPending}>
              {activeMutation.isPending ? t("evals.editor.saving") : t("evals.editor.save")}
            </Button>
          </div>
        </div>
      }
    >
      {error && (
        <div
          role="alert"
          style={{
            fontSize: 12.5,
            color: "var(--crit)",
            background: "var(--crit-bg)",
            padding: "8px 22px",
          }}
        >
          {error}
        </div>
      )}

      {pureNegative && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            margin: "12px 22px 0",
            padding: "8px 12px",
            borderRadius: 8,
            background: "var(--crit-bg)",
            border: "1px solid var(--crit)",
          }}
        >
          <Badge color="var(--crit)" bg="transparent" icon="XCircle">
            {t("evals.editor.negativeBadge")}
          </Badge>
          <span style={{ fontSize: 12.5, color: "var(--text-secondary)", fontFamily: "var(--font-mono, ui-monospace, monospace)" }}>
            {t("evals.editor.negativeBody", { location: negLocation })}
          </span>
        </div>
      )}

      <div style={st.body}>
        {/* ---------------------------- LEFT: Input ------------------------ */}
        <div style={{ ...st.panel, ...st.panelLeft }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={st.fieldLabel}>{t("evals.editor.name")}</span>
            <TextInput value={name} onChange={setName} placeholder={t("evals.editor.namePlaceholder")} />
          </label>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={st.sectionLabel}>{t("evals.editor.input")}</span>
            <Tabs tabs={tabs} value={activeTab} onChange={setActiveTab} pad="0" />

            {activeTab === "diff" && (
              <>
                <Textarea value={diff} onChange={setDiff} rows={9} mono placeholder={t("evals.editor.diffPlaceholder")} />
                <span style={st.smallLabel}>{t("evals.editor.diffPreview")}</span>
                <div style={{ maxHeight: 260, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 8 }}>
                  <DiffViewer files={rawDiffToPrFiles(diff)} />
                </div>
              </>
            )}

            {activeTab === "files" && (
              <div style={{ ...st.code, minHeight: 120 }}>
                {files.length === 0 ? (
                  <span style={{ color: "var(--text-muted)" }}>{t("evals.editor.filesEmpty")}</span>
                ) : (
                  files.map((f) => <div key={f}>{f}</div>)
                )}
              </div>
            )}

            {activeTab === "prMeta" && (
              <div style={{ ...st.code, minHeight: 120 }}>
                <div style={st.metaGrid}>
                  <span style={st.metaKey}>{t("evals.editor.prMetaSource")}</span>
                  <span>
                    {source === "finding"
                      ? t("evals.editor.prMetaSourceFinding")
                      : t("evals.editor.prMetaSourceManual")}
                  </span>
                  <span style={st.metaKey}>{t("evals.editor.prMetaPr")}</span>
                  <span>{initialCase?.source_pr_number != null ? `#${initialCase.source_pr_number}` : t("evals.editor.prMetaNone")}</span>
                  <span style={st.metaKey}>{t("evals.editor.prMetaFinding")}</span>
                  <span>{initialCase?.source_finding_id ?? t("evals.editor.prMetaNone")}</span>
                </div>
              </div>
            )}
          </div>

          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={st.fieldLabel}>{t("evals.editor.notes")}</span>
            <Textarea value={notes} onChange={setNotes} rows={2} placeholder={t("evals.editor.notesPlaceholder")} />
          </label>
        </div>

        {/* ------------------------ RIGHT: Expected output ----------------- */}
        <div style={st.panel}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={st.sectionLabel}>{t("evals.editor.expectedOutput")}</span>
              <Badge
                color={assertEmpty ? "var(--text-muted)" : "var(--ok)"}
                bg={assertEmpty ? "var(--bg-hover)" : "var(--ok-bg)"}
                icon={assertEmpty ? "XCircle" : "CheckCircle"}
              >
                {assertEmpty ? t("evals.expectation.assertEmpty") : t("evals.editor.validJson")}
              </Badge>
            </div>
            <Button
              kind="secondary"
              size="sm"
              icon="Plus"
              onClick={() => setExpectations((prev) => [...prev, emptyExpectation("must_find")])}
            >
              {t("evals.editor.findingSkeleton")}
            </Button>
          </div>

          {/* Read-only finding-skeleton view (mirrors the agent's Finding shape). */}
          <pre style={st.code}>
            {skeleton}
            {assertEmpty ? `\n${t("evals.editor.assertEmptyComment")}` : ""}
          </pre>

          {/* Structured editor — the actual source of truth for scoring. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {expectations.map((exp) => (
              <div key={exp.key} style={st.expCard}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 70px 70px auto", gap: 8, alignItems: "end" }}>
                  {/* NOT a <label>: the custom SelectInput self-selects option[0]
                      when wrapped in a label (B1 — client/insights.md). */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={st.smallLabel}>{t("evals.editor.expectationType")}</span>
                    <SelectInput
                      value={exp.type}
                      onChange={(v) => updateExpectation(exp.key, { type: v as Expectation["type"] })}
                      options={[
                        { value: "must_find", label: t("evals.expectation.must_find") },
                        { value: "must_not_flag", label: t("evals.expectation.must_not_flag") },
                      ]}
                      mono={false}
                    />
                  </div>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={st.smallLabel}>{t("evals.editor.lineStart")}</span>
                    <TextInput
                      value={String(exp.line_start)}
                      onChange={(v) => updateExpectation(exp.key, { line_start: Number(v) || 0 })}
                      type="number"
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={st.smallLabel}>{t("evals.editor.lineEnd")}</span>
                    <TextInput
                      value={String(exp.line_end)}
                      onChange={(v) => updateExpectation(exp.key, { line_end: Number(v) || 0 })}
                      type="number"
                    />
                  </label>
                  <Button kind="ghost" size="sm" onClick={() => removeExpectation(exp.key)}>
                    {t("evals.editor.removeExpectation")}
                  </Button>
                </div>

                {/* severity/category mirror the Finding shape the agent emits;
                    shown only for must_find (a must_not_flag is a negative zone,
                    no finding to describe). Display-only — not scored (AC-24). */}
                {exp.type === "must_find" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={st.smallLabel}>{t("evals.editor.severity")}</span>
                      <SelectInput
                        value={exp.severity ?? ""}
                        onChange={(v) => updateExpectation(exp.key, { severity: v || null })}
                        options={severityOptions}
                        mono={false}
                      />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={st.smallLabel}>{t("evals.editor.category")}</span>
                      <SelectInput
                        value={exp.category ?? ""}
                        onChange={(v) => updateExpectation(exp.key, { category: v || null })}
                        options={categoryOptions}
                        mono={false}
                      />
                    </div>
                  </div>
                )}

                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={st.smallLabel}>{t("evals.editor.file")}</span>
                  <TextInput
                    value={exp.file}
                    onChange={(v) => updateExpectation(exp.key, { file: v })}
                    placeholder={t("evals.editor.filePlaceholder")}
                    mono
                  />
                </label>
              </div>
            ))}
          </div>

          {showLastRun && (
            <div
              style={{
                marginTop: "auto",
                fontSize: 12.5,
                color: `var(${lastRunColorVar})`,
                background: "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "8px 12px",
              }}
            >
              {lastRunText}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
