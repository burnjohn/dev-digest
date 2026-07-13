/* EvalDashboardView — cross-agent Eval Dashboard (T10, SPEC-03 AC-20).
   Route: /evals (no dynamic segments — no useParams needed here).

   Features:
   - Lists every reviewer agent with current recall/precision/citation + recent runs (AC-20)
   - Metric up/down deltas carry text + icon, never color alone (a11y)
   - "Run all agents" button (POST /eval-runs/all)
   - CompareModal: select two run groups → per-metric delta + system_prompt diff +
     Promote version button (AC-16/18); degrades to "version unavailable" (edge case) */
"use client";

import React from "react";
import { Button, EmptyState, ErrorState, Icon, Modal, Skeleton } from "@devdigest/ui";
import type { EvalDashboard, EvalRunGroup } from "@devdigest/shared";
import {
  useEvalDashboard,
  useRunAllAgents,
  useEvalRunGroups,
  useCompareRuns,
  usePromoteVersion,
} from "@/lib/hooks/evals";
import { s } from "./styles";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function dateLabel(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// DeltaLabel — textual + iconic delta (a11y: not color alone, SPEC-03 Non-functional)
// ---------------------------------------------------------------------------

function DeltaLabel({ delta }: { delta: number }) {
  const positive = delta > 0;
  const zero = delta === 0;
  const label = zero ? "no change" : positive ? `+${pct(delta)}` : pct(delta);
  const ariaLabel = zero
    ? "no change"
    : positive
      ? `improved by ${pct(delta)}`
      : `decreased by ${pct(Math.abs(delta))}`;

  return (
    <span style={s.metricDelta(positive, zero)} aria-label={ariaLabel}>
      {!zero &&
        (positive ? (
          <Icon.TrendingUp size={11} aria-hidden="true" />
        ) : (
          <Icon.TrendingDown size={11} aria-hidden="true" />
        ))}
      {!zero && (positive ? "up " : "down ")}
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// PassFailBadge — text + icon, never color alone (a11y)
// ---------------------------------------------------------------------------

function PassFailBadge({ pass }: { pass: boolean | null }) {
  if (pass === null) {
    return (
      <span style={s.passBadge(null)} aria-label="no data">
        <Icon.Clock size={11} aria-hidden="true" />
        no data
      </span>
    );
  }
  return (
    <span style={s.passBadge(pass)} aria-label={pass ? "pass" : "fail"}>
      {pass ? (
        <Icon.CheckCircle size={11} aria-hidden="true" />
      ) : (
        <Icon.XCircle size={11} aria-hidden="true" />
      )}
      {pass ? "pass" : "fail"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// CompareModal — two run group selection + per-metric deltas + prompt diff +
//                Promote version button (AC-16/18)
// ---------------------------------------------------------------------------

interface CompareModalProps {
  agentId: string;
  agentName: string;
  runGroups: EvalRunGroup[];
  onClose: () => void;
}

function CompareModal({ agentId, agentName, runGroups, onClose }: CompareModalProps) {
  const [groupIdA, setGroupIdA] = React.useState<string>(runGroups[0]?.id ?? "");
  const [groupIdB, setGroupIdB] = React.useState<string>(runGroups[1]?.id ?? "");

  const compare = useCompareRuns(
    agentId,
    groupIdA || undefined,
    groupIdB || undefined,
  );
  const promote = usePromoteVersion();

  const canCompare = !!groupIdA && !!groupIdB && groupIdA !== groupIdB;

  // Promote the version reported by the compare response — the authoritative
  // agent_version for the compared run, matching the button label (AC-18).
  const handlePromoteA = () => {
    const v = compare.data?.group_a.agent_version;
    if (v != null) promote.mutate({ agentId, version: v });
  };

  const handlePromoteB = () => {
    const v = compare.data?.group_b.agent_version;
    if (v != null) promote.mutate({ agentId, version: v });
  };

  return (
    <Modal
      width={860}
      title={`Compare runs — ${agentName}`}
      subtitle="Select two run groups to compare metrics and system prompt changes."
      onClose={onClose}
      footer={
        <div style={s.modalFooter}>
          <Button kind="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div style={{ padding: "20px 24px" }}>
        {/* Run group selectors */}
        <div style={s.selectRow}>
          <div style={s.selectGroup}>
            <div style={s.selectLabel}>Baseline (A)</div>
            <select
              style={s.runGroupSelect}
              value={groupIdA}
              onChange={(e) => setGroupIdA(e.target.value)}
              aria-label="Select baseline run group A"
            >
              <option value="">— select run —</option>
              {runGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {dateLabel(g.ran_at)} · v{g.agent_version}
                  {g.label ? ` · ${g.label}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div style={s.selectGroup}>
            <div style={s.selectLabel}>Candidate (B)</div>
            <select
              style={s.runGroupSelect}
              value={groupIdB}
              onChange={(e) => setGroupIdB(e.target.value)}
              aria-label="Select candidate run group B"
            >
              <option value="">— select run —</option>
              {runGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {dateLabel(g.ran_at)} · v{g.agent_version}
                  {g.label ? ` · ${g.label}` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Compare result */}
        {canCompare && compare.isLoading && <Skeleton height={200} />}

        {canCompare && compare.isError && (
          <ErrorState body="Could not load comparison." onRetry={() => void compare.refetch()} />
        )}

        {canCompare && compare.data && (
          <>
            {/* Per-metric deltas (AC-16) */}
            <div style={s.compareLabel}>Metric deltas (B − A)</div>
            <table style={s.deltaTable} aria-label="Metric deltas table">
              <thead>
                <tr>
                  <th style={s.th}>Metric</th>
                  <th style={s.th}>Baseline (A)</th>
                  <th style={s.th}>Candidate (B)</th>
                  <th style={s.th}>Delta</th>
                  <th style={s.th}>Direction</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    [
                      "Recall",
                      compare.data.group_a.recall,
                      compare.data.group_b.recall,
                      compare.data.delta.recall,
                    ],
                    [
                      "Precision",
                      compare.data.group_a.precision,
                      compare.data.group_b.precision,
                      compare.data.delta.precision,
                    ],
                    [
                      "Citation",
                      compare.data.group_a.citation_accuracy,
                      compare.data.group_b.citation_accuracy,
                      compare.data.delta.citation_accuracy,
                    ],
                  ] as [string, number, number, number][]
                ).map(([label, a, b, delta]) => (
                  <tr key={label} style={s.deltaRow}>
                    <td style={s.deltaCell}>{label}</td>
                    <td style={s.deltaCell}>{pct(a)}</td>
                    <td style={s.deltaCell}>{pct(b)}</td>
                    <td style={s.deltaCell}>{pct(Math.abs(delta))}</td>
                    <td style={s.deltaCell}>
                      <DeltaLabel delta={delta} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* System prompt diff (AC-16, keyboard-navigable via tabIndex) */}
            <div style={s.diffSection}>
              <div style={s.diffLabel}>System prompt diff</div>
              {compare.data.system_prompt_diff === "" ? (
                <p style={s.versionUnavailable}>Prompts are identical — no diff.</p>
              ) : compare.data.prompt_a === "version unavailable" ||
                compare.data.prompt_b === "version unavailable" ? (
                <p style={s.versionUnavailable} data-testid="version-unavailable">
                  version unavailable — one or both recorded versions were pruned.
                </p>
              ) : (
                <pre
                  style={s.comparePre}
                  tabIndex={0}
                  aria-label="System prompt diff (keyboard-navigable)"
                >
                  {compare.data.system_prompt_diff}
                </pre>
              )}
            </div>

            {/* Side-by-side raw prompts */}
            <div style={s.compareGrid}>
              <div>
                <div style={s.compareLabel}>
                  Baseline prompt — v{compare.data.group_a.agent_version}
                </div>
                <pre style={s.comparePre} tabIndex={0} aria-label="Baseline system prompt">
                  {compare.data.prompt_a}
                </pre>
              </div>
              <div>
                <div style={s.compareLabel}>
                  Candidate prompt — v{compare.data.group_b.agent_version}
                </div>
                <pre style={s.comparePre} tabIndex={0} aria-label="Candidate system prompt">
                  {compare.data.prompt_b}
                </pre>
              </div>
            </div>

            {/* Promote version buttons (AC-18) */}
            <div
              style={{
                display: "flex",
                gap: 10,
                marginTop: 16,
                borderTop: "1px solid var(--border)",
                paddingTop: 14,
              }}
            >
              <Button
                kind="secondary"
                onClick={handlePromoteA}
                loading={promote.isPending}
                disabled={promote.isPending}
              >
                Promote v{compare.data.group_a.agent_version} (A)
              </Button>
              <Button
                kind="primary"
                onClick={handlePromoteB}
                loading={promote.isPending}
                disabled={promote.isPending}
              >
                Promote v{compare.data.group_b.agent_version} (B)
              </Button>
            </div>
          </>
        )}

        {!canCompare && groupIdA && groupIdB && groupIdA === groupIdB && (
          <p style={s.versionUnavailable}>Select two different run groups to compare.</p>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// AgentCard — one agent's current metrics + recent runs + compare trigger
// ---------------------------------------------------------------------------

interface AgentCardProps {
  dashboard: EvalDashboard;
}

function AgentCard({ dashboard }: AgentCardProps) {
  const [showCompare, setShowCompare] = React.useState(false);

  // Real run-group list (newest-first) for the Compare selector — actual group
  // ids + recorded agent versions, so a selected run resolves to an existing
  // group on the server (AC-16). Replaces reconstructing stubs from trend points.
  const runGroupsQuery = useEvalRunGroups(dashboard.owner_id);
  const runGroups: EvalRunGroup[] = runGroupsQuery.data ?? [];

  const agentName = dashboard.owner_id ?? "Unknown agent";
  const current = dashboard.current;
  const delta = dashboard.delta;
  const recentRuns = dashboard.recent_runs ?? [];

  const hasRuns = recentRuns.length > 0;

  return (
    <div style={s.card} data-testid={`agent-card-${dashboard.owner_id ?? "unknown"}`}>
      {/* Agent header */}
      <div style={s.cardHeader}>
        <Icon.FlaskConical size={16} aria-hidden="true" />
        <div style={s.agentName}>{agentName}</div>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {dashboard.cases_total} case{dashboard.cases_total !== 1 ? "s" : ""}
        </span>
        {hasRuns && runGroups.length >= 2 && (
          <Button
            kind="ghost"
            size="sm"
            icon="BarChart"
            onClick={() => setShowCompare(true)}
          >
            Compare
          </Button>
        )}
      </div>

      {/* Current metrics */}
      <div style={s.metricRow}>
        {(
          [
            ["Recall", current.recall, delta.recall],
            ["Precision", current.precision, delta.precision],
            ["Citation", current.citation_accuracy, delta.citation_accuracy],
          ] as [string, number, number][]
        ).map(([label, value, d]) => (
          <div key={label} style={s.metric}>
            <div style={s.metricLabel}>{label}</div>
            <div style={s.metricValue}>{pct(value)}</div>
            <DeltaLabel delta={d} />
          </div>
        ))}
      </div>

      {/* Recent runs table */}
      <div style={s.runsSection}>
        <div style={s.runsSectionTitle}>
          <span>Recent runs</span>
        </div>
        {!hasRuns ? (
          <div style={s.emptyRuns}>No runs yet — create eval cases and run them.</div>
        ) : (
          <table style={s.runsTable} aria-label={`Recent runs for agent ${agentName}`}>
            <thead>
              <tr>
                <th style={s.th}>Ran at</th>
                <th style={s.th}>Recall</th>
                <th style={s.th}>Precision</th>
                <th style={s.th}>Citation</th>
                <th style={s.th}>Pass</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.slice(0, 5).map((run) => (
                <tr key={run.id}>
                  <td style={s.td}>{dateLabel(run.ran_at)}</td>
                  <td style={s.td}>{run.recall !== null ? pct(run.recall) : "—"}</td>
                  <td style={s.td}>{run.precision !== null ? pct(run.precision) : "—"}</td>
                  <td style={s.td}>
                    {run.citation_accuracy !== null ? pct(run.citation_accuracy) : "—"}
                  </td>
                  <td style={s.td}>
                    <PassFailBadge pass={run.pass ?? null} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Compare modal */}
      {showCompare && (
        <CompareModal
          agentId={dashboard.owner_id ?? ""}
          agentName={agentName}
          runGroups={runGroups}
          onClose={() => setShowCompare(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EvalDashboardView — main cross-agent dashboard (AC-20)
// ---------------------------------------------------------------------------

export function EvalDashboardView() {
  const dashboard = useEvalDashboard();
  const runAll = useRunAllAgents();

  if (dashboard.isLoading) return <Skeleton height={300} />;
  if (dashboard.isError)
    return (
      <ErrorState
        body="Could not load eval dashboard."
        onRetry={() => void dashboard.refetch()}
      />
    );

  const agents = dashboard.data ?? [];

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.h1}>Eval Dashboard</h1>
        <div style={s.runAllBtn}>
          <Button
            kind="primary"
            icon="Play"
            loading={runAll.isPending}
            disabled={runAll.isPending || agents.length === 0}
            onClick={() => runAll.mutate()}
          >
            {runAll.isPending ? "Running…" : "Run all agents"}
          </Button>
        </div>
      </div>

      <p style={s.hint}>
        Current recall / precision / citation for every reviewer agent, and their recent run history.
        Select two runs on an agent card to compare prompt versions.
      </p>

      {agents.length === 0 ? (
        <EmptyState
          icon="FlaskConical"
          title="No eval data yet"
          body="Create eval cases for your reviewer agents and run them to see metrics here."
        />
      ) : (
        <div style={s.cardList}>
          {agents.map((agent) => (
            <AgentCard key={agent.owner_id ?? "unknown"} dashboard={agent} />
          ))}
        </div>
      )}
    </div>
  );
}
