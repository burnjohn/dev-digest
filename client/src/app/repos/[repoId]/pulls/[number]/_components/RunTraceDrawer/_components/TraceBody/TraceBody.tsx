/* TraceBody — the Trace tab content: Configuration, Stats, Findings, Prompt
   assembly, Tool calls, and Raw output sections for one persisted RunTrace. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { RunTrace, FindingRecord } from "@devdigest/shared";
import { PROMPT_COLORS } from "../../constants";
import { formatSeconds, formatTokens } from "../../helpers";
import { formatCost } from "@/lib/format";
import { s } from "../../styles";
import { TraceSection } from "../TraceSection";
import { ToolCallRow } from "../ToolCallRow";
import { PromptBlock } from "../PromptBlock";
import { FindingsSection } from "../FindingsSection";
import { Row, Stat } from "../atoms";

export function TraceBody({ trace, findings }: { trace: RunTrace; findings: FindingRecord[] }) {
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

      <FindingsSection findings={findings} />

      <TraceSection
        icon="FileText"
        title={t("trace.contextDocs.title")}
        right={<Badge color="var(--text-muted)">{trace.context_documents.length}</Badge>}
      >
        {trace.context_documents.length === 0 ? (
          <span style={s.contextDocEmpty}>{t("trace.contextDocs.empty")}</span>
        ) : (
          trace.context_documents.map((doc, i) => (
            <div
              key={`${doc.path}-${i}`}
              style={i === trace.context_documents.length - 1 ? { ...s.contextDocRow, ...s.contextDocLastRow } : s.contextDocRow}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className="mono" style={s.contextDocPath} title={doc.path}>
                  {doc.path}
                </span>
                {doc.status === "skipped" && doc.skip_reason && (
                  <div style={s.contextDocSkipReason}>{doc.skip_reason}</div>
                )}
              </div>
              <span className="tnum" style={s.contextDocTokens}>
                {t("trace.contextDocs.tokens", { count: doc.token_size })}
              </span>
              {doc.status === "injected" ? (
                <Badge color="var(--ok)" bg="var(--ok-bg)" icon="Check">
                  {t("trace.contextDocs.injected")}
                </Badge>
              ) : (
                <Badge color="var(--text-muted)" icon="X">
                  {t("trace.contextDocs.skipped")}
                </Badge>
              )}
            </div>
          ))
        )}
        {trace.context_documents.some((d) => d.status === "injected") && (
          <p style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 8, marginBottom: 0 }}>
            {t("trace.contextDocs.openFullTextHint")}
          </p>
        )}
      </TraceSection>

      <TraceSection icon="FileText" title={t("trace.promptAssembly")} defaultOpen={false}>
        <PromptBlock label={t("trace.prompt.system")} text={trace.prompt_assembly.system} color={PROMPT_COLORS.system} />
        {trace.prompt_assembly.skills != null && (
          <PromptBlock label={t("trace.prompt.skills")} text={trace.prompt_assembly.skills} color={PROMPT_COLORS.skills} highlight />
        )}
        {trace.prompt_assembly.memory != null && (
          <PromptBlock label={t("trace.prompt.memory")} text={trace.prompt_assembly.memory} color={PROMPT_COLORS.memory} />
        )}
        {trace.prompt_assembly.repo_map != null && (
          <PromptBlock label={t("trace.prompt.repoMap")} text={trace.prompt_assembly.repo_map} color={PROMPT_COLORS.repoMap} />
        )}
        {trace.prompt_assembly.specs != null && (
          <PromptBlock label={t("trace.prompt.specs")} text={trace.prompt_assembly.specs} color={PROMPT_COLORS.specs} />
        )}
        {trace.prompt_assembly.callers != null && (
          <PromptBlock label={t("trace.prompt.callers")} text={trace.prompt_assembly.callers} color={PROMPT_COLORS.callers} />
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
