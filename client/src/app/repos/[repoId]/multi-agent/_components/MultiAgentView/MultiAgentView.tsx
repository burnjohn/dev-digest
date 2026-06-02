/* MultiAgentView — A5 Multi-Agent Review columns / tabs + conflicts.
   Ported from screen_multiagent.jsx. Renders a MultiAgentRun (N agent columns
   or per-agent tabs) plus the "Where agents disagree" conflict section. Colors
   are derived per-column by index (the Agent contract has no color field). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, CircularScore, Icon, MonoLink, SectionLabel, Toggle } from "@devdigest/ui";
import type {
  AgentColumn,
  AgentColumnFinding,
  Conflict,
  MultiAgentRun,
} from "@devdigest/shared/contracts/observability";
import { SEV, MAX_INLINE_COLUMNS } from "./constants";
import {
  colorFor,
  iconFor,
  scoreColor,
  formatCost,
  formatDuration,
  columnCount,
  isFlagged,
} from "./helpers";
import { s } from "./styles";

function FindingMini({ f }: { f: AgentColumnFinding }) {
  const t = useTranslations("runs");
  const sev = SEV[f.severity] ?? SEV.SUGGESTION!;
  const I = Icon[sev.icon];
  return (
    <div style={s.findingCard(sev.c)}>
      <div style={s.findingHead}>
        <I size={12} style={s.findingIcon(sev.c)} />
        <span style={s.findingTitle}>{f.title}</span>
      </div>
      <div className="mono" style={s.findingMeta}>
        {f.file}:{f.start_line}
        {f.kind === "lethal_trifecta" && (
          <Badge color="var(--crit)" bg="transparent" style={s.trifectaBadge}>
            {t("finding.trifecta")}
          </Badge>
        )}
      </div>
    </div>
  );
}

function ColHeader({ col, color, icon }: { col: AgentColumn; color: string; icon: ReturnType<typeof iconFor> }) {
  const I = Icon[icon];
  return (
    <div style={s.colHeader}>
      <div style={s.colHeaderIcon(color)}>
        <I size={16} />
      </div>
      <div style={s.colHeaderBody}>
        <div style={s.colHeaderName}>{col.agent_name}</div>
        <div className="mono tnum" style={s.colHeaderMeta}>
          {formatDuration(col.duration_ms)} · {formatCost(col.cost_usd)}
        </div>
      </div>
      {col.score != null && <CircularScore score={col.score} size={32} stroke={3.5} />}
    </div>
  );
}

function ConflictsSection({
  conflicts,
  onlyConflicts,
  onToggleOnly,
}: {
  conflicts: Conflict[];
  onlyConflicts: boolean;
  onToggleOnly: (v: boolean) => void;
}) {
  const t = useTranslations("runs");
  return (
    <div style={s.conflictsWrap}>
      <SectionLabel
        icon="Activity"
        right={
          <label style={s.conflictToggleLabel}>
            {t("conflicts.onlyConflicts")}
            <Toggle on={onlyConflicts} onChange={onToggleOnly} size={15} />
          </label>
        }
      >
        {t("conflicts.title")}
      </SectionLabel>
      {conflicts.length === 0 ? (
        <div style={s.conflictsEmpty}>{t("conflicts.empty")}</div>
      ) : (
        <div style={s.conflictsList}>
          {conflicts.map((c, i) => (
            <div key={i} style={s.conflictCard}>
              <div style={s.conflictCardHead}>
                <Icon.Code size={13} style={s.conflictIcon} />
                <span className="mono" style={s.conflictLoc}>
                  {c.file}:{c.line}
                </span>
                <span style={s.conflictTitle}>{c.title}</span>
              </div>
              <div style={s.conflictTakesGrid(c.takes.length)}>
                {c.takes.map((tk, ti) => {
                  const flagged = isFlagged(tk.verdict);
                  const dot = flagged ? (SEV[tk.verdict as string]?.c ?? "var(--warn)") : "var(--text-muted)";
                  return (
                    <div key={ti} style={s.conflictTake}>
                      <div style={s.takePersona}>{tk.persona}</div>
                      <div style={s.takeVerdictRow}>
                        <span style={s.takeDot(dot)} />
                        <span style={s.takeVerdict(flagged)}>
                          {flagged ? tk.verdict : t("conflicts.didNotFlag")}
                        </span>
                      </div>
                      <div style={s.takeNote}>{tk.note}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ColumnsView({
  run,
  onViewTrace,
  onlyConflicts,
  onToggleOnly,
}: {
  run: MultiAgentRun;
  onViewTrace: (col: AgentColumn) => void;
  onlyConflicts: boolean;
  onToggleOnly: (v: boolean) => void;
}) {
  const t = useTranslations("runs");
  const n = run.columns.length;
  const cols = columnCount(n, MAX_INLINE_COLUMNS);
  return (
    <div style={s.columnsPad}>
      {!onlyConflicts && (
        <div style={s.columnsGrid(cols, n > MAX_INLINE_COLUMNS)}>
          {run.columns.map((col, i) => (
            <div key={col.run_id} style={s.column(colorFor(i))}>
              <div style={s.columnHeadCell(colorFor(i))}>
                <ColHeader col={col} color={colorFor(i)} icon={iconFor(i)} />
              </div>
              <div style={s.columnBody}>
                {col.findings.length === 0 ? (
                  <span style={s.columnEmpty}>{t("column.noFindings")}</span>
                ) : (
                  col.findings.map((f) => <FindingMini key={f.id} f={f} />)
                )}
              </div>
              <div style={s.columnFoot}>
                <button onClick={() => onViewTrace(col)} style={s.linkBtn}>
                  <MonoLink>{t("viewTrace")}</MonoLink>
                </button>
                <span style={s.columnFootCount}>
                  {t("column.findingsCount", { count: col.findings.length })}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      <ConflictsSection conflicts={run.conflicts} onlyConflicts={onlyConflicts} onToggleOnly={onToggleOnly} />
    </div>
  );
}

function TabsView({
  run,
  selected,
  onSelect,
  onViewTrace,
  onlyConflicts,
  onToggleOnly,
}: {
  run: MultiAgentRun;
  selected: number;
  onSelect: (i: number) => void;
  onViewTrace: (col: AgentColumn) => void;
  onlyConflicts: boolean;
  onToggleOnly: (v: boolean) => void;
}) {
  const t = useTranslations("runs");
  const sel = Math.min(selected, run.columns.length - 1);
  const col = run.columns[sel];
  if (!col) return null;
  return (
    <div style={s.tabsPad}>
      <div style={s.tabBar}>
        {run.columns.map((c, i) => {
          const on = sel === i;
          const I = Icon[iconFor(i)];
          const sc = c.score ?? 0;
          return (
            <button key={c.run_id} onClick={() => onSelect(i)} style={s.tab(on, colorFor(i))}>
              <I size={15} style={s.tabIcon(on, colorFor(i))} />
              <span style={s.tabName(on)}>{c.agent_name}</span>
              <span className="tnum" style={s.tabScore(scoreColor(sc))}>
                {c.score ?? "—"}
              </span>
            </button>
          );
        })}
      </div>
      <div style={s.tabPanel}>
        <div style={s.tabSummaryCard(colorFor(sel))}>
          {col.score != null && <CircularScore score={col.score} size={44} />}
          <div>
            <div style={s.tabSummaryName(colorFor(sel))}>{col.agent_name}</div>
            <p style={s.tabSummaryText}>{col.summary ?? t("tabs.noSummary")}</p>
          </div>
          <div style={s.tabSummaryAside}>
            <button onClick={() => onViewTrace(col)} style={s.linkBtn}>
              <MonoLink>{t("viewTrace")}</MonoLink>
            </button>
            <span className="mono tnum" style={s.tabSummaryMeta}>
              {formatDuration(col.duration_ms)} · {formatCost(col.cost_usd)}
            </span>
          </div>
        </div>
        <div style={s.tabFindings}>
          {col.findings.map((f) => (
            <FindingMini key={f.id} f={f} />
          ))}
        </div>
      </div>
      <div style={s.tabConflictsPad}>
        <ConflictsSection conflicts={run.conflicts} onlyConflicts={onlyConflicts} onToggleOnly={onToggleOnly} />
      </div>
    </div>
  );
}

export interface MultiAgentViewProps {
  run: MultiAgentRun;
  view: "columns" | "tabs";
  /** Selected agent index for tabs view (?agent=). */
  selectedAgent?: number;
  onSelectAgent?: (i: number) => void;
  onlyConflicts?: boolean;
  onToggleOnlyConflicts?: (v: boolean) => void;
  onViewTrace?: (col: AgentColumn) => void;
}

export function MultiAgentView({
  run,
  view,
  selectedAgent = 0,
  onSelectAgent = () => {},
  onlyConflicts = false,
  onToggleOnlyConflicts = () => {},
  onViewTrace = () => {},
}: MultiAgentViewProps) {
  if (view === "tabs") {
    return (
      <TabsView
        run={run}
        selected={selectedAgent}
        onSelect={onSelectAgent}
        onViewTrace={onViewTrace}
        onlyConflicts={onlyConflicts}
        onToggleOnly={onToggleOnlyConflicts}
      />
    );
  }
  return (
    <ColumnsView
      run={run}
      onViewTrace={onViewTrace}
      onlyConflicts={onlyConflicts}
      onToggleOnly={onToggleOnlyConflicts}
    />
  );
}

export default MultiAgentView;
