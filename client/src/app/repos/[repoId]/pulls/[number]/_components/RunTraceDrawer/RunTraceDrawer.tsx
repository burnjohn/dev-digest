/* RunTraceDrawer — A5 Run Trace + Live Log drawer (720px). Ported from
   screen_trace.jsx. Tabs: Trace (Configuration / Stats / Prompt assembly /
   Tool calls / Raw output) and Live log (SSE via useRunEvents → LiveLogStream,
   which has client-side Filter-input search). Default export so the PR-detail
   page (A2) can mount it from the run-status area. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Drawer, Icon, LiveLogStream, Tabs, type LogLine } from "@devdigest/ui";
import type { RunTrace, ToolCall } from "@devdigest/shared";
import { useRunTrace } from "../../../../../../../lib/hooks/trace";
import { useRunEvents } from "../../../../../../../lib/hooks/reviews";
import { DRAWER_WIDTH, LOG_HEIGHT, PROMPT_COLORS, TABS } from "./constants";
import { eventsToLog, formatCost, formatSeconds, formatTokens, traceLog } from "./helpers";
import { s } from "./styles";

function TraceSection({
  icon,
  title,
  right,
  children,
  defaultOpen = true,
}: {
  icon: "Settings" | "Gauge" | "FileText" | "Wrench" | "Code";
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const I = Icon[icon];
  return (
    <div style={s.section}>
      <div onClick={() => setOpen((o) => !o)} style={s.sectionHead}>
        <I size={15} style={s.sectionIcon} />
        <span style={s.sectionTitle}>{title}</span>
        {right}
        <Icon.ChevronDown size={15} style={s.chevron(open)} />
      </div>
      {open && <div style={s.sectionBody}>{children}</div>}
    </div>
  );
}

function ToolCallRow({ tc }: { tc: ToolCall }) {
  const t = useTranslations("runs");
  const [open, setOpen] = React.useState(false);
  return (
    <div style={s.toolRow}>
      <div onClick={() => setOpen((o) => !o)} style={s.toolHead}>
        <Icon.Wrench size={13} style={s.toolIcon} />
        <span className="mono" style={s.toolName}>
          {tc.tool}
          <span style={s.toolArgs}>({tc.args})</span>
        </span>
        <span style={s.toolMeta}>{tc.meta}</span>
        <span className="mono tnum" style={s.toolMs}>
          {tc.ms}ms
        </span>
      </div>
      {open && (
        <div className="mono" style={s.toolDetail}>
          {t("trace.tools.args")}: {tc.args}
          <br />
          {t("trace.tools.result")}: {tc.meta ?? "—"} {t("trace.tools.previewTruncated")}
        </div>
      )}
    </div>
  );
}

function PromptBlock({ label, text, color }: { label: string; text: string; color: string }) {
  const t = useTranslations("runs");
  const [open, setOpen] = React.useState(false);
  return (
    <div style={s.promptRow}>
      <div onClick={() => setOpen((o) => !o)} style={s.promptHead}>
        <span style={s.promptDot(color)} />
        <span style={s.promptLabel}>{label}</span>
        <span style={s.promptToggle}>{open ? t("trace.collapse") : t("trace.expand")}</span>
      </div>
      {open && (
        <pre className="mono" style={s.promptPre}>
          {text || "—"}
        </pre>
      )}
    </div>
  );
}

function Stat({ label, val }: { label: string; val: React.ReactNode }) {
  return (
    <div style={s.stat}>
      <div style={s.statLabel}>{label}</div>
      <div className="tnum" style={s.statVal}>
        {val}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={s.row}>
      <span style={s.rowLabel}>{label}</span>
      {children}
    </div>
  );
}

function TraceBody({ trace }: { trace: RunTrace }) {
  const t = useTranslations("runs");
  const stats = trace.stats;
  return (
    <>
      <TraceSection icon="Settings" title={t("trace.configuration")}>
        <div style={s.configList}>
          <Row label={t("trace.config.model")}>
            <span className="mono" style={s.configModel}>
              {trace.config.model}
            </span>
          </Row>
          <Row label={t("trace.config.provider")}>
            <span className="mono" style={s.configProvider}>
              {trace.config.provider ?? "—"}
            </span>
          </Row>
          <Row label={t("trace.config.memoryPulled")}>
            <span>{t("trace.config.items", { count: trace.memory_pulled.length })}</span>
          </Row>
          <Row label={t("trace.config.specsRead")}>
            <div style={s.specsWrap}>
              {trace.specs_read.length === 0 ? (
                <span style={s.specsNone}>{t("trace.config.none")}</span>
              ) : (
                trace.specs_read.map((sp, i) => (
                  <span key={i} className="mono" style={s.spec}>
                    {sp}
                  </span>
                ))
              )}
            </div>
          </Row>
        </div>
      </TraceSection>

      <TraceSection
        icon="Gauge"
        title={t("trace.stats")}
        right={
          <Badge color="var(--ok)" bg="var(--ok-bg)" icon="Check">
            {stats.grounding}
          </Badge>
        }
      >
        <div style={s.statsRow}>
          <Stat label={t("trace.stat.duration")} val={formatSeconds(stats.duration_ms)} />
          <Stat label={t("trace.stat.tokens")} val={formatTokens(stats.tokens_in, stats.tokens_out)} />
          <Stat label={t("trace.stat.cost")} val={formatCost(stats.cost_usd)} />
          <Stat label={t("trace.stat.findings")} val={stats.findings} />
        </div>
      </TraceSection>

      <TraceSection icon="FileText" title={t("trace.promptAssembly")} defaultOpen={false}>
        <PromptBlock label={t("trace.prompt.system")} text={trace.prompt_assembly.system} color={PROMPT_COLORS.system} />
        {trace.prompt_assembly.skills != null && (
          <PromptBlock label={t("trace.prompt.skills")} text={trace.prompt_assembly.skills} color={PROMPT_COLORS.skills} />
        )}
        {trace.prompt_assembly.memory != null && (
          <PromptBlock label={t("trace.prompt.memory")} text={trace.prompt_assembly.memory} color={PROMPT_COLORS.memory} />
        )}
        <PromptBlock label={t("trace.prompt.user")} text={trace.prompt_assembly.user} color={PROMPT_COLORS.user} />
      </TraceSection>

      <TraceSection
        icon="Wrench"
        title={t("trace.toolCalls")}
        right={<Badge color="var(--text-muted)">{trace.tool_calls.length}</Badge>}
      >
        {trace.tool_calls.length === 0 ? (
          <span style={s.noToolCalls}>{t("trace.noToolCalls")}</span>
        ) : (
          trace.tool_calls.map((tc, i) => <ToolCallRow key={i} tc={tc} />)
        )}
      </TraceSection>

      <TraceSection icon="Code" title={t("trace.rawOutput")} defaultOpen={false}>
        <pre className="mono" style={s.rawPre}>
          {trace.raw_output || "—"}
        </pre>
      </TraceSection>
    </>
  );
}

export interface RunTraceDrawerProps {
  runId: string;
  /** Title context (agent name / PR number). */
  agentName?: string | null;
  prNumber?: number | null;
  /** When true, the drawer defaults to the live log and streams SSE. */
  running?: boolean;
  onClose: () => void;
}

/**
 * Run Trace + Live Log drawer. While `running`, the Live-log tab streams events
 * over SSE (useRunEvents). The Trace tab loads the persisted single-document
 * RunTrace (useRunTrace) once the run completes (or for historical runs).
 */
export default function RunTraceDrawer({
  runId,
  agentName,
  prNumber,
  running = false,
  onClose,
}: RunTraceDrawerProps) {
  const t = useTranslations("runs");
  const [tab, setTab] = React.useState<string>(running ? "log" : "trace");
  const { events, running: liveRunning } = useRunEvents(running ? [runId] : []);
  // Load the persisted trace once we're not (or no longer) running.
  const stillRunning = running && liveRunning;
  const { data: trace, isLoading } = useRunTrace(runId, !stillRunning);

  const log: LogLine[] = eventsToLog(events);
  // When historical, fall back to the trace's persisted log for the Live-log tab.
  const persistedLog: LogLine[] = traceLog(trace);
  const shownLog = running ? log : persistedLog;

  const prCtx = prNumber != null ? `${t("drawer.pr", { number: prNumber })} · ` : "";
  const subtitle = `${prCtx}${stillRunning ? t("drawer.running") : t("drawer.completed")}`;

  return (
    <Drawer
      width={DRAWER_WIDTH}
      title={t("drawer.title", { agent: agentName ?? trace?.config.agent ?? t("drawer.run") })}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="secondary" size="sm" icon="Copy">
            {t("drawer.copyRawOutput")}
          </Button>
        </div>
      }
    >
      <Tabs tabs={[...TABS]} value={tab} onChange={setTab} pad="0" />
      <div style={s.tabBody}>
        {tab === "trace" ? (
          isLoading && !trace ? (
            <div style={s.emptyNote}>
              {stillRunning ? t("drawer.tracePending") : t("drawer.loadingTrace")}
            </div>
          ) : trace ? (
            <TraceBody trace={trace} />
          ) : (
            <div style={s.emptyNote}>{t("drawer.noTrace")}</div>
          )
        ) : (
          <LiveLogStream log={shownLog} running={stillRunning} height={LOG_HEIGHT} />
        )}
      </div>
    </Drawer>
  );
}
