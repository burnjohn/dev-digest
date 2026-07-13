/* EvalsTab — per-agent eval case management + run-all.
   Mirrors the sibling SkillsTab/ContextTab structure (T9, SPEC-03 AC-5).

   Features:
   - Lists the agent's eval cases (GET /agents/:id/eval-cases)
   - Per-case pass/fail label from the latest in-session run (not color-only — a11y)
   - "New eval case" modal (Diff / Files / PR-meta input tabs + expected-JSON)
   - "Run-all-evals" button (POST /agents/:id/eval-runs)
   - Empty state when zero cases */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, Modal, Skeleton } from "@devdigest/ui";
import type { Agent, EvalCase, EvalRunGroupResult, EvalRunResult } from "@devdigest/shared";
import { useEvalCases, useDeleteEvalCase, useRunAgentEvals, useCreateEvalCaseManual } from "@/lib/hooks/evals";
import { s } from "./styles";

// ---------------------------------------------------------------------------
// Pass/Fail badge — text + icon, never color alone (a11y, SPEC-03 Non-functional)
// ---------------------------------------------------------------------------

function PassFailBadge({ pass }: { pass: boolean }) {
  const t = useTranslations("eval.evalsTab");
  return (
    <span style={s.passBadge(pass)} aria-label={pass ? t("passed") : t("failed")}>
      {pass ? <Icon.CheckCircle size={12} aria-hidden="true" /> : <Icon.XCircle size={12} aria-hidden="true" />}
      {pass ? t("passed") : t("failed")}
    </span>
  );
}

function NeverRunBadge() {
  const t = useTranslations("eval.evalsTab");
  return (
    <span style={s.neverRun} aria-label={t("neverRun")}>
      <Icon.Clock size={12} aria-hidden="true" />
      {t("neverRun")}
    </span>
  );
}

// ---------------------------------------------------------------------------
// New eval case modal — Diff / Files / PR-meta input tabs + expected JSON
// ---------------------------------------------------------------------------

const INPUT_TABS = ["diff", "files", "prMeta"] as const;
type InputTab = (typeof INPUT_TABS)[number];

const DEFAULT_EXPECTED = JSON.stringify(
  {
    type: "must_find",
    findings: [
      {
        file: "src/example.ts",
        start_line: 1,
        end_line: 1,
        severity: "critical",
        title: "Example finding title",
        body: "Describe what the agent must flag.",
      },
    ],
  },
  null,
  2,
);

interface NewCaseModalProps {
  agentId: string;
  onClose: () => void;
  onCreated: () => void;
}

function NewCaseModal({ agentId, onClose, onCreated }: NewCaseModalProps) {
  const t = useTranslations("eval.caseEditor");
  const [inputTab, setInputTab] = React.useState<InputTab>("diff");
  const [name, setName] = React.useState("");
  const [diff, setDiff] = React.useState("");
  const [prTitle, setPrTitle] = React.useState("");
  const [prBody, setPrBody] = React.useState("");
  const [expectedJson, setExpectedJson] = React.useState(DEFAULT_EXPECTED);
  const [jsonError, setJsonError] = React.useState<string | null>(null);

  // Use typed api.post mutation instead of raw fetch (CLIENT-001/002).
  const createCase = useCreateEvalCaseManual();

  const validateJson = (value: string) => {
    try {
      JSON.parse(value);
      setJsonError(null);
    } catch {
      setJsonError(t("invalidJson"));
    }
  };

  const handleExpectedChange = (value: string) => {
    setExpectedJson(value);
    validateJson(value);
  };

  const handleSave = () => {
    if (jsonError) return;
    let expectedOutput: unknown;
    try {
      expectedOutput = JSON.parse(expectedJson);
    } catch {
      setJsonError(t("invalidJson"));
      return;
    }

    createCase.mutate(
      {
        agentId,
        owner_kind: "agent",
        owner_id: agentId,
        name: name || "Unnamed case",
        input_diff: diff,
        input_meta: prTitle || prBody ? { title: prTitle, body: prBody } : undefined,
        expected_output: expectedOutput,
      },
      {
        onSuccess: () => {
          onCreated();
          onClose();
        },
        // Errors are surfaced by the hook's onError toast — modal stays open
        // so the user can retry (CLIENT-002: notify.error is called by hook).
      },
    );
  };

  const saving = createCase.isPending;

  return (
    <Modal
      width={740}
      title={t("newCase")}
      subtitle="Provide a diff and the findings this agent must (or must not) emit."
      onClose={onClose}
      footer={
        <div style={s.modalFooter}>
          <Button kind="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            kind="primary"
            onClick={handleSave}
            loading={saving}
            disabled={!!jsonError || saving}
          >
            {saving ? t("saving") : t("save")}
          </Button>
        </div>
      }
    >
      <div style={s.modalBody}>
        {/* Name */}
        <div>
          <div style={s.modalLabel}>{t("nameLabel")}</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            style={s.modalInput}
          />
        </div>

        {/* Input (Diff / Files / PR meta tabs) */}
        <div>
          <div style={s.modalLabel}>{t("inputLabel")}</div>
          <div style={s.inputTabBar} role="tablist">
            {INPUT_TABS.map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={inputTab === tab}
                style={s.inputTab(inputTab === tab)}
                onClick={() => setInputTab(tab)}
              >
                {tab === "diff" ? t("tabs.diff") : tab === "prMeta" ? t("tabs.prMeta") : "Files"}
              </button>
            ))}
          </div>
          {inputTab === "diff" && (
            <textarea
              value={diff}
              onChange={(e) => setDiff(e.target.value)}
              placeholder={t("diffPlaceholder")}
              rows={10}
              style={s.modalTextarea}
            />
          )}
          {inputTab === "files" && (
            <textarea
              placeholder="Paste file contents as JSON array, e.g. [{&quot;path&quot;: &quot;src/index.ts&quot;, &quot;content&quot;: &quot;...&quot;}]"
              rows={10}
              style={s.modalTextarea}
            />
          )}
          {inputTab === "prMeta" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div>
                <div style={s.modalLabel}>{t("titleLabel")}</div>
                <input
                  value={prTitle}
                  onChange={(e) => setPrTitle(e.target.value)}
                  placeholder={t("titlePlaceholder")}
                  style={s.modalInput}
                />
              </div>
              <div>
                <div style={s.modalLabel}>{t("bodyLabel")}</div>
                <textarea
                  value={prBody}
                  onChange={(e) => setPrBody(e.target.value)}
                  placeholder={t("bodyPlaceholder")}
                  rows={5}
                  style={s.modalTextarea}
                />
              </div>
            </div>
          )}
        </div>

        {/* Expected output (findings JSON) */}
        <div>
          <div style={s.modalLabel}>
            {t("expectedOutput")}
            {jsonError ? (
              <span style={{ color: "var(--crit)", marginLeft: 8 }}>{jsonError}</span>
            ) : (
              <span style={{ color: "var(--ok)", marginLeft: 8 }}>{t("validJson")}</span>
            )}
          </div>
          <textarea
            value={expectedJson}
            onChange={(e) => handleExpectedChange(e.target.value)}
            rows={12}
            style={s.modalTextarea}
          />
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// EvalsTab — main component
// ---------------------------------------------------------------------------

export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("eval.evalsTab");
  const cases = useEvalCases(agent.id);
  const deleteMut = useDeleteEvalCase();
  const runMut = useRunAgentEvals();

  const [showNewModal, setShowNewModal] = React.useState(false);
  // Per-case pass/fail from the latest in-session run result.
  const [lastRunResults, setLastRunResults] = React.useState<EvalRunResult[] | null>(null);

  const passMap = React.useMemo(() => {
    if (!lastRunResults) return new Map<string, boolean>();
    return new Map(lastRunResults.map((r) => [r.case_id, r.result.per_trace?.[0]?.pass ?? false]));
  }, [lastRunResults]);

  const handleRunAll = () => {
    runMut.mutate(
      { agentId: agent.id },
      {
        onSuccess: (data: EvalRunGroupResult) => {
          setLastRunResults(data.results);
        },
      },
    );
  };

  const handleDelete = (evalCase: EvalCase) => {
    deleteMut.mutate({ agentId: agent.id, caseId: evalCase.id });
  };

  if (cases.isLoading) return <Skeleton height={220} />;
  if (cases.isError)
    return (
      <ErrorState
        body="Could not load eval cases."
        onRetry={() => void cases.refetch()}
      />
    );

  const caseList = cases.data ?? [];

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("casesHeading")}</h2>
        <span style={s.count}>{caseList.length} case{caseList.length !== 1 ? "s" : ""}</span>
        <div style={s.runBtn}>
          <Button
            kind="secondary"
            icon="Play"
            loading={runMut.isPending}
            disabled={caseList.length === 0 || runMut.isPending}
            onClick={handleRunAll}
          >
            {runMut.isPending ? t("running") : t("run")}
          </Button>
          <Button
            kind="primary"
            icon="Plus"
            style={{ marginLeft: 8 }}
            onClick={() => setShowNewModal(true)}
          >
            {t("newCase")}
          </Button>
        </div>
      </div>

      <p style={s.hint}>
        Eval cases test this agent against frozen inputs. Run-all to score recall / precision / citation accuracy.
      </p>

      {caseList.length === 0 ? (
        <EmptyState
          icon="FlaskConical"
          title="No eval cases yet"
          body={t("emptyCases")}
          cta={t("newCase")}
          onCta={() => setShowNewModal(true)}
        />
      ) : (
        <div style={s.list}>
          {caseList.map((evalCase) => {
            const hasResult = lastRunResults !== null;
            const pass = passMap.get(evalCase.id);

            return (
              <div key={evalCase.id} style={s.row}>
                <div style={s.text}>
                  <div style={s.name}>{evalCase.name}</div>
                  {evalCase.notes && <div style={s.meta}>{evalCase.notes}</div>}
                </div>

                {/* Pass/Fail — text + icon, NOT color alone (a11y AC) */}
                {!hasResult ? (
                  <NeverRunBadge />
                ) : pass !== undefined ? (
                  <PassFailBadge pass={pass} />
                ) : (
                  <NeverRunBadge />
                )}

                <div style={s.controls}>
                  <button
                    aria-label={`Delete ${evalCase.name}`}
                    style={s.deleteBtn}
                    disabled={deleteMut.isPending}
                    onClick={() => handleDelete(evalCase)}
                  >
                    <Icon.Trash size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showNewModal && (
        <NewCaseModal
          agentId={agent.id}
          onClose={() => setShowNewModal(false)}
          onCreated={() => void cases.refetch()}
        />
      )}
    </div>
  );
}
