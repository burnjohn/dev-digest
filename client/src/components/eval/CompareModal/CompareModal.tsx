"use client";

/* CompareModal (Agent Eval Dashboard, AC-18..AC-23) — the "Compare runs"
   modal opened from the detail page's Recent-Runs table. Matches the design:
   - a subtitle line,
   - four metric cards (Recall / Precision / Citation / Cost) each showing the
     older run's value → the newer run's value + a signed delta chip,
   - a "System prompt diff" section with an old/new legend and a word-level
     diff, plus graceful fallbacks (see PromptSection),
   - a Close + Promote footer.

   `result.a`/`result.b` map 1:1 to whichever ids the CALLER passed as
   `batchIdA`/`batchIdB` — the server does NOT reorder them by `ran_at`. This
   component derives which side is chronologically OLDER vs NEWER (via `ran_at`)
   and drives every "old → new" reading, the diff direction, and the Promote
   target off that, never off the raw a/b query-param order.

   Every `vN` here (title, legend, Promote) is the PROMPT version — it bumps
   only when the system-prompt text changes, so two runs on an unchanged prompt
   read "v1 → v1" (intentional). There is no separate run/attempt ordinal. */

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Button } from "@devdigest/ui";
import type { EvalBatch, EvalBatchDetail } from "@devdigest/shared";
import { formatCost } from "@/lib/format";
import { useEvalCompare } from "@/lib/hooks/eval";
import { usePromoteAgentPrompt } from "@/lib/hooks/agents";
import { useToast } from "@/lib/toast";
import { pct, deltaColor, promptVersionMap } from "../helpers";
import { diffWords } from "./diffWords";

interface CompareModalProps {
  agentId: string;
  batchIdA: string;
  batchIdB: string;
  /** Full batch history for this agent — used to derive each batch's PROMPT
   *  version (via `promptVersionMap`), which drives every `vN` in the modal. */
  batches: EvalBatch[];
  onClose: () => void;
}

export function CompareModal({ agentId, batchIdA, batchIdB, batches, onClose }: CompareModalProps) {
  const t = useTranslations("evals");
  const toast = useToast();
  const compare = useEvalCompare(agentId, batchIdA, batchIdB);
  const promote = usePromoteAgentPrompt(agentId);

  const result = compare.data;

  // Every `vN` in the modal is the PROMPT version: it bumps only when the
  // prompt text actually changes, so an unchanged prompt keeps the same
  // `prompt vN` across many runs (running the same prompt twice reads
  // "v1 → v1", never a phantom bump).
  const promptVersions = React.useMemo(() => promptVersionMap(batches), [batches]);
  const promptVersionOf = (batchId: string): number | null => promptVersions.get(batchId) ?? null;

  // Chronological order — never assume `b` is the newer side (see file header).
  const newer = result && new Date(result.b.ran_at).getTime() >= new Date(result.a.ran_at).getTime() ? result.b : result?.a;
  const older = result ? (newer === result.b ? result.a : result.b) : undefined;

  const newerPromptVersion = newer ? promptVersionOf(newer.id) : null;
  const olderPromptVersion = older ? promptVersionOf(older.id) : null;
  const canPromote = !!newer && newer.system_prompt_snapshot != null;

  const handlePromote = () => {
    if (!newer) return;
    promote.mutate(newer.id, {
      onSuccess: (agent) => {
        toast.success(t("compare.promoteSuccess", { version: newerPromptVersion ?? agent.version }));
        onClose();
      },
      onError: () => toast.error(t("compare.promoteError")),
    });
  };

  // Title shows the PROMPT versions being compared (decision: title by prompt
  // versions — two runs on the same prompt read "v1 → v1"). Falls back to the
  // generic title when either side predates prompt tracking (no version).
  const title =
    olderPromptVersion != null && newerPromptVersion != null
      ? t("compare.titleVersions", { old: olderPromptVersion, new: newerPromptVersion })
      : t("compare.title");

  return (
    <Modal title={title} onClose={onClose} width={860}>
      <div style={st.body}>
        <p style={st.subtitle}>{t("compare.subtitle")}</p>

        {compare.isLoading && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>…</span>}

        {older && newer && (
          <>
            <div style={st.metricGrid}>
              <MetricCard label={t("compare.metric.recall")} color="var(--accent)" oldV={older.recall} newV={newer.recall} />
              <MetricCard label={t("compare.metric.precision")} color="var(--ok)" oldV={older.precision} newV={newer.precision} />
              <MetricCard label={t("compare.metric.citation")} color="var(--warn)" oldV={older.citation_accuracy} newV={newer.citation_accuracy} />
              <MetricCard label={t("compare.metric.cost")} color="var(--text-primary)" oldV={older.cost_usd} newV={newer.cost_usd} kind="cost" />
            </div>

            <PromptSection
              older={older}
              newer={newer}
              olderPromptVersion={olderPromptVersion}
              newerPromptVersion={newerPromptVersion}
            />
          </>
        )}
      </div>

      <div style={st.footer}>
        <Button kind="secondary" size="sm" onClick={onClose}>
          {t("compare.close")}
        </Button>
        <Button
          kind="primary"
          size="sm"
          icon="GitBranch"
          disabled={!canPromote || promote.isPending}
          loading={promote.isPending}
          onClick={handlePromote}
        >
          {t("compare.promote", { version: newerPromptVersion ?? "" })}
        </Button>
        {!canPromote && newer && (
          <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>
            {t("compare.promoteDisabledNoSnapshot")}
          </span>
        )}
      </div>
    </Modal>
  );
}

/** One KPI card: OLD → NEW value + a signed delta chip. `kind="cost"` formats
 *  as currency (USD) and shows the raw delta; otherwise values are 0..1 ratios
 *  rendered as percentages with a "pt" (percentage-point) delta. */
function MetricCard({
  label,
  color,
  oldV,
  newV,
  kind = "ratio",
}: {
  label: string;
  color: string;
  oldV: number | null;
  newV: number | null;
  kind?: "ratio" | "cost";
}) {
  const bothKnown = oldV != null && newV != null;
  const delta = bothKnown ? newV - oldV : null;
  const arrow = delta == null || delta === 0 ? "" : delta > 0 ? "▲" : "▼";

  const oldStr = kind === "cost" ? formatCost(oldV) : pct(oldV);
  const newStr = kind === "cost" ? formatCost(newV) : pct(newV);
  const deltaStr =
    delta == null
      ? null
      : kind === "cost"
        ? `${arrow} ${formatCost(Math.abs(delta))}`.trim()
        : `${arrow} ${Math.abs(Math.round(delta * 100))}pt`.trim();

  return (
    <div style={st.card}>
      <div style={st.cardLabel}>{label}</div>
      <div style={st.cardValueRow}>
        <span style={st.oldValue}>{oldStr}</span>
        <span style={st.arrow}>→</span>
        <span style={{ ...st.newValue, color }}>{newStr}</span>
        {deltaStr && <span style={{ ...st.deltaChip, color: deltaColor(delta ?? 0) }}>{deltaStr}</span>}
      </div>
    </div>
  );
}

/** System-prompt section — handles every snapshot-availability case:
 *  - both present & different → old/new legend + word-level diff
 *  - both present & identical → "unchanged" note + the prompt verbatim (show
 *    the version, per requirement)
 *  - newer present, older missing → newer prompt verbatim + a note
 *  - newer missing → "no stored prompt" note (Promote is disabled upstream) */
function PromptSection({
  older,
  newer,
  olderPromptVersion,
  newerPromptVersion,
}: {
  older: EvalBatchDetail;
  newer: EvalBatchDetail;
  /** PROMPT versions (bump only on a real prompt-text change), not run versions. */
  olderPromptVersion: number | null;
  newerPromptVersion: number | null;
}) {
  const t = useTranslations("evals");
  const oldP = older.system_prompt_snapshot;
  const newP = newer.system_prompt_snapshot;

  const bothPresent = oldP != null && newP != null;
  const identical = bothPresent && oldP === newP;

  return (
    <div>
      <div style={st.promptHeader}>
        <span style={st.sectionLabel}>{t("compare.promptDiffTitle")}</span>
        {bothPresent && !identical && (
          <div style={st.legend}>
            <span style={st.legendItem}>
              <span style={{ ...st.legendSwatch, background: "var(--crit)" }} />
              {t("compare.legendOld", { version: olderPromptVersion ?? "?" })}
            </span>
            <span style={st.legendItem}>
              <span style={{ ...st.legendSwatch, background: "var(--ok)" }} />
              {t("compare.legendNew", { version: newerPromptVersion ?? "?" })}
            </span>
          </div>
        )}
      </div>

      {/* newer has no prompt at all → nothing to show/promote */}
      {newP == null && <Note>{t("compare.promptDiffUnavailable")}</Note>}

      {/* newer present, older missing → show newer verbatim + explain that the
          prompt version only bumps on an actual edit (not on every run) */}
      {newP != null && oldP == null && (
        <>
          <Note>{t("compare.promptOldMissing", { version: newerPromptVersion ?? "?" })}</Note>
          <VerbatimPrompt text={newP} />
        </>
      )}

      {/* both present + identical → "unchanged", show the (single) prompt version */}
      {identical && (
        <>
          <Note>{t("compare.promptUnchanged", { version: newerPromptVersion ?? "?" })}</Note>
          <VerbatimPrompt text={newP!} />
        </>
      )}

      {/* both present + different → word diff (old → new) */}
      {bothPresent && !identical && <DiffPrompt oldText={oldP!} newText={newP!} />}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div role="note" style={st.note}>
      {children}
    </div>
  );
}

function DiffPrompt({ oldText, newText }: { oldText: string; newText: string }) {
  const tokens = diffWords(oldText, newText);
  return (
    <pre style={st.pre}>
      {tokens.map((token, idx) => {
        if (token.type === "equal") return <span key={idx}>{token.text}</span>;
        if (token.type === "removed") {
          return (
            <span key={idx} style={{ textDecoration: "line-through", background: "var(--crit-bg)", color: "var(--crit)" }}>
              {token.text}
            </span>
          );
        }
        return (
          <span key={idx} style={{ background: "var(--ok-bg)", color: "var(--ok)" }}>
            {token.text}
          </span>
        );
      })}
    </pre>
  );
}

function VerbatimPrompt({ text }: { text: string }) {
  return <pre style={st.pre}>{text}</pre>;
}

const st = {
  body: { padding: "16px 24px 4px", display: "flex", flexDirection: "column", gap: 18 } as React.CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-secondary)", marginTop: -4 } as React.CSSProperties,
  metricGrid: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 } as React.CSSProperties,
  card: {
    padding: "14px 16px",
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 10,
  } as React.CSSProperties,
  cardLabel: {
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 10,
  } as React.CSSProperties,
  cardValueRow: { display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" } as React.CSSProperties,
  oldValue: { fontSize: 14, color: "var(--text-muted)" } as React.CSSProperties,
  arrow: { fontSize: 13, color: "var(--text-muted)" } as React.CSSProperties,
  newValue: { fontSize: 22, fontWeight: 700, lineHeight: 1 } as React.CSSProperties,
  deltaChip: { fontSize: 11.5, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 2 } as React.CSSProperties,
  promptHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
    flexWrap: "wrap",
  } as React.CSSProperties,
  sectionLabel: {
    fontSize: 11,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    fontWeight: 600,
  } as React.CSSProperties,
  legend: { display: "flex", gap: 14 } as React.CSSProperties,
  legendItem: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-secondary)" } as React.CSSProperties,
  legendSwatch: { width: 11, height: 11, borderRadius: 3, display: "inline-block" } as React.CSSProperties,
  note: {
    fontSize: 12,
    color: "var(--text-muted)",
    padding: "10px 12px",
    background: "var(--bg-hover)",
    borderRadius: 6,
    marginBottom: 8,
  } as React.CSSProperties,
  pre: {
    fontSize: 12.5,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    padding: "12px 14px",
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    maxHeight: 320,
    overflow: "auto",
    margin: 0,
  } as React.CSSProperties,
  footer: { display: "flex", gap: 10, padding: "14px 24px", borderTop: "1px solid var(--border)" } as React.CSSProperties,
} as const;
