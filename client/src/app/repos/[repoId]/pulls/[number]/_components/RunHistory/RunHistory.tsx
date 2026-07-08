"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, CircularScore, SEV, type IconName } from "@devdigest/ui";
import type { RunSummary, PrCommit, ReviewRecord, FindingRecord } from "@devdigest/shared";
import { formatCost } from "@/lib/format";
import { usePopupPosition } from "@/lib/hooks";

/**
 * PR timeline — every agent run interleaved with the PR's commits, newest-first
 * and DB-backed so it survives reload. Showing commits between runs makes it
 * clear which commit each review ran against. Failed runs show their error
 * inline; clicking a run row opens its trace.
 *
 * The badge reflects the review OUTCOME, not just the run lifecycle: a finished
 * run that found blockers reads "rejected" (red), never a green "done". Outcome
 * is derived from the denormalized blocker/finding counts on the run row, so it
 * matches the CI gate (deterministic) rather than the model's verdict.
 */

type Outcome = { key: string; color: string; bg: string; icon: IconName };

function outcomeOf(run: RunSummary): Outcome {
  const status = run.status ?? "";
  if (status === "running")
    return { key: "running", color: "var(--accent)", bg: "var(--accent-bg)", icon: "RefreshCw" };
  if (status === "failed")
    return { key: "error", color: "var(--crit)", bg: "var(--crit-bg)", icon: "XCircle" };
  if (status === "cancelled")
    return { key: "cancelled", color: "var(--text-muted)", bg: "var(--bg-hover)", icon: "X" };
  // Settled ("done"): color by the deterministic outcome.
  if ((run.blockers ?? 0) > 0)
    return { key: "rejected", color: "var(--crit)", bg: "var(--crit-bg)", icon: "XCircle" };
  if ((run.findings_count ?? 0) > 0)
    return { key: "reviewed", color: "var(--warn)", bg: "var(--warn-bg)", icon: "MessageSquare" };
  return { key: "approved", color: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle" };
}

const SEV_DISPLAY = (["CRITICAL", "WARNING", "SUGGESTION"] as const).map((dbKey) => ({
  key: dbKey.toLowerCase() as "critical" | "warning" | "suggestion",
  dbKey,
  label: SEV[dbKey].label.slice(0, 4).toUpperCase(),
  color: SEV[dbKey].c,
  SevIcon: Icon[SEV[dbKey].icon],
}));

type PopupState = {
  runId: string;
  severity: "CRITICAL" | "WARNING" | "SUGGESTION";
  top: number;
  left: number;
} | null;

// ---- Finding popup ----------------------------------------------------------

function FindingPopup({
  findings,
  onClose,
  top,
  left,
}: {
  findings: FindingRecord[];
  onClose: () => void;
  top: number;
  left: number;
}) {
  const [ref, adjustedLeft] = usePopupPosition(left);

  React.useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, ref]);

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        top,
        left: adjustedLeft,
        zIndex: 1200,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "12px 14px",
        minWidth: 320,
        maxWidth: 460,
        maxHeight: 380,
        overflowY: "auto",
        boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
      }}
    >
      {findings.length === 0 ? (
        <span style={{ color: "var(--text-muted)", fontSize: 13 }}>No findings</span>
      ) : (
        findings.map((f, i) => (
          <div
            key={f.id}
            style={{
              borderBottom: i < findings.length - 1 ? "1px solid var(--border)" : "none",
              paddingBottom: i < findings.length - 1 ? 10 : 0,
              marginBottom: i < findings.length - 1 ? 10 : 0,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>{f.title}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
              <span className="mono">{f.file}:{f.start_line}</span>
              {" · "}
              {Math.round(f.confidence * 100)}% confidence
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-secondary)",
                marginTop: 5,
                lineHeight: 1.55,
              }}
            >
              {f.rationale.length > 220 ? f.rationale.slice(0, 217) + "…" : f.rationale}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ---- Row styles -------------------------------------------------------------

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  width: "100%",
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg-elevated)",
  textAlign: "left",
};

const iconBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 4,
  borderRadius: 5,
  border: "1px solid var(--border)",
  background: "var(--bg-surface)",
  color: "var(--text-muted)",
  cursor: "pointer",
  flexShrink: 0,
};

// Commits are markers, not actions — lighter (dashed, transparent) so they read
// as separators between the runs they sit chronologically between.
const commitRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  width: "100%",
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px dashed var(--border)",
  background: "transparent",
};

type TimelineItem =
  | { kind: "run"; ts: number; run: RunSummary }
  | { kind: "commit"; ts: number; commit: PrCommit };

/** Epoch ms for sorting; unparseable / missing timestamps sort last. */
function tsOf(s: string | null | undefined): number {
  if (!s) return 0;
  const n = Date.parse(s);
  return Number.isNaN(n) ? 0 : n;
}

export function RunHistory({
  runs,
  commits = [],
  reviewsByRunId,
  onOpenTrace,
  onGoToReview,
  onDelete,
}: {
  runs: RunSummary[];
  commits?: PrCommit[];
  /** ReviewRecord keyed by run_id — used by the severity-icon popup. */
  reviewsByRunId?: Map<string, ReviewRecord>;
  /** Open the trace + log drawer for a run (the logs icon). */
  onOpenTrace: (runId: string) => void;
  /** Jump to this run's inline review accordion below (clicking the agent name). */
  onGoToReview?: (runId: string) => void;
  onDelete?: (runId: string) => void;
}) {
  const t = useTranslations("prReview");
  const [popup, setPopup] = React.useState<PopupState>(null);

  if (runs.length === 0 && commits.length === 0) return null;

  const items: TimelineItem[] = [
    ...runs.map((run) => ({ kind: "run" as const, ts: tsOf(run.ran_at), run })),
    ...commits.map((commit) => ({
      kind: "commit" as const,
      ts: tsOf(commit.committed_at),
      commit,
    })),
  ].sort((a, b) => b.ts - a.ts);

  const popupFindings: FindingRecord[] =
    popup && reviewsByRunId
      ? (reviewsByRunId.get(popup.runId)?.findings ?? []).filter(
          (f) => f.severity === popup.severity,
        )
      : [];

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((item) => {
          if (item.kind === "commit") {
            const c = item.commit;
            return (
              <div key={`commit:${c.sha}`} style={commitRowStyle}>
                <Icon.GitCommit size={15} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                <span className="mono" style={{ fontSize: 12, color: "var(--text-secondary)", flexShrink: 0 }}>
                  {c.sha.slice(0, 7)}
                </span>
                <span
                  style={{
                    fontSize: 12.5,
                    color: "var(--text-secondary)",
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={c.message}
                >
                  {c.message.split("\n")[0]}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>{c.author}</span>
                {c.committed_at && (
                  <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
                    {new Date(c.committed_at).toLocaleTimeString()}
                  </span>
                )}
              </div>
            );
          }

          const r = item.run;
          const o = outcomeOf(r);
          const settled = r.status === "done";
          const bd = r.findings_breakdown;

          return (
            <div key={`run:${r.run_id}`} style={rowStyle}>
              <Badge color={o.color} bg={o.bg} icon={o.icon}>
                {t(`runStatus.${o.key}`)}
              </Badge>
              {settled && r.score != null && <CircularScore score={r.score} size={30} stroke={3} />}
              <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                  <button
                    type="button"
                    onClick={() => onGoToReview?.(r.run_id)}
                    title={t("timeline.goToReview")}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      font: "inherit",
                      fontWeight: 600,
                      color: "var(--text-primary)",
                      cursor: onGoToReview ? "pointer" : "default",
                      textDecoration: onGoToReview ? "underline" : "none",
                      textDecorationStyle: "dotted",
                      textUnderlineOffset: 3,
                    }}
                  >
                    {r.agent_name ?? "Agent"}
                  </button>{" "}
                  <span className="mono" style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>
                    {r.provider}/{r.model}
                  </span>
                </div>
                {r.status === "failed" && r.error && (
                  <div
                    style={{ fontSize: 12, color: "var(--crit)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={r.error}
                  >
                    {r.error}
                  </div>
                )}
                {settled && bd ? (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {SEV_DISPLAY.map(({ key, label, color, dbKey, SevIcon }) => {
                      const cnt = bd[key];
                      return (
                        <button
                          key={key}
                          type="button"
                          title={`${cnt} ${label} finding${cnt !== 1 ? "s" : ""} — click to preview`}
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setPopup((prev) =>
                              prev?.runId === r.run_id && prev.severity === dbKey
                                ? null
                                : { runId: r.run_id, severity: dbKey, top: rect.bottom + 6, left: rect.left },
                            );
                          }}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 3,
                            padding: "2px 4px",
                            border: "none",
                            background: "transparent",
                            color,
                            opacity: cnt > 0 ? 1 : 0.45,
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: reviewsByRunId && cnt > 0 ? "pointer" : "default",
                          }}
                        >
                          <SevIcon size={11} />
                          {cnt}
                        </button>
                      );
                    })}
                  </div>
                ) : settled ? (
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {t("runStatus.findings", { count: r.findings_count ?? 0 })}
                    {(r.blockers ?? 0) > 0 ? t("runStatus.blockers", { count: r.blockers ?? 0 }) : ""}
                  </div>
                ) : null}
                {settled && (r.tokens_in != null || r.cost_usd != null) && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                    {r.tokens_in != null && `${r.tokens_in.toLocaleString()} tok`}
                    {r.tokens_in != null && r.cost_usd != null && " · "}
                    {r.cost_usd != null && formatCost(r.cost_usd)}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
                {r.ran_at && <span>{new Date(r.ran_at).toLocaleTimeString()}</span>}
              </div>
              <button
                type="button"
                title={t("timeline.openTrace")}
                aria-label={t("timeline.openTrace")}
                onClick={() => onOpenTrace(r.run_id)}
                style={iconBtnStyle}
              >
                <Icon.FileText size={13} />
              </button>
              {onDelete && r.status !== "running" && (
                <button
                  type="button"
                  aria-label={t("timeline.deleteRun")}
                  title={t("timeline.deleteRun")}
                  onClick={() => onDelete(r.run_id)}
                  style={{ display: "inline-flex", padding: 3, borderRadius: 5, color: "var(--text-muted)", flexShrink: 0, cursor: "pointer", background: "none", border: "none" }}
                >
                  <Icon.Trash size={13} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {popup && (
        <FindingPopup
          findings={popupFindings}
          top={popup.top}
          left={popup.left}
          onClose={() => setPopup(null)}
        />
      )}
    </>
  );
}
