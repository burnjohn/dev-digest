"use client";

import React from "react";
import { SectionLabel, Icon } from "@devdigest/ui";
import type { ReviewRecord, PrBrief, DownstreamImpact } from "@devdigest/shared";
import { VerdictBanner } from "../VerdictBanner";
import { usePrBrief } from "@/lib/hooks/reviews";
import { s } from "./styles";

// ---- helpers ----------------------------------------------------------------

function httpMethod(ep: string) {
  const m = ep.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD)\s+/);
  return m ? { method: m[1]!, path: ep.slice(m[1]!.length + 1) } : { method: null, path: ep };
}

function riskColor(severity: string) {
  return severity === "high"
    ? "var(--crit)"
    : severity === "medium"
      ? "var(--warn)"
      : "var(--text-muted)";
}

// ---- IntentCard -------------------------------------------------------------

function IntentCard({ brief }: { brief: PrBrief }) {
  const { intent, risks } = brief;
  return (
    <div style={s.card}>
      <div style={s.cardHeader}>
        <Icon.GitBranch size={12} />
        Intent
      </div>
      <div style={s.cardBody}>
        <blockquote style={s.intentQuote}>"{intent.intent}"</blockquote>

        <div style={{ display: "flex", gap: 20 }}>
          {intent.in_scope.length > 0 && (
            <div style={{ ...s.scopeSection, flex: 1 }}>
              <div style={s.scopeHeader("var(--ok)")}>In scope</div>
              {intent.in_scope.map((item, i) => (
                <div key={i} style={s.scopeItem}>
                  <Icon.Check size={12} style={{ color: "var(--ok)", flexShrink: 0, marginTop: 2 }} />
                  {item}
                </div>
              ))}
            </div>
          )}

          {intent.out_of_scope.length > 0 && (
            <div style={{ ...s.scopeSection, flex: 1 }}>
              <div style={s.scopeHeader("var(--crit)")}>Out of scope</div>
              {intent.out_of_scope.map((item, i) => (
                <div key={i} style={s.scopeItem}>
                  <Icon.X size={12} style={{ color: "var(--crit)", flexShrink: 0, marginTop: 2 }} />
                  {item}
                </div>
              ))}
            </div>
          )}
        </div>

        {risks.risks.length > 0 && (
          <div>
            <div style={s.scopeHeader("var(--text-muted)")}>Risk areas</div>
            <div style={s.riskGrid}>
              {risks.risks.map((r, i) => {
                const c = riskColor(r.severity);
                return (
                  <span key={i} style={s.riskChip(c)}>
                    <span style={s.riskDot(c)} />
                    {r.title}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- BlastRadiusCard --------------------------------------------------------

function BlastRadiusCard({ brief }: { brief: PrBrief }) {
  const { blast, history } = brief;
  const [priorOpen, setPriorOpen] = React.useState(false);

  const totalCallers = blast.downstream.reduce((sum, d) => sum + d.callers.length, 0);
  const totalEndpoints = blast.downstream.reduce((sum, d) => sum + d.endpoints_affected.length, 0);
  const totalCrons = blast.downstream.reduce((sum, d) => sum + d.crons_affected.length, 0);
  const priorCount = history.history.length;

  return (
    <div style={s.card}>
      <div style={s.cardHeader}>
        <Icon.Zap size={12} />
        Blast radius
      </div>
      <div style={s.cardBody}>
        {/* Stats row */}
        <div style={s.statsRow}>
          <span style={s.statItem}>
            <Icon.Code size={12} />
            <span style={s.statCount}>{blast.changed_symbols.length}</span> symbols
          </span>
          <span style={s.statItem}>
            <Icon.ArrowRight size={12} />
            <span style={s.statCount}>{totalCallers}</span> callers
          </span>
          <span style={s.statItem}>
            <Icon.Globe size={12} />
            <span style={s.statCount}>{totalEndpoints}</span> endpoints
          </span>
          <span style={s.statItem}>
            <Icon.Clock size={12} />
            <span style={s.statCount}>{totalCrons}</span> cron
          </span>
          <span style={s.toggleRow}>
            <button type="button" style={s.toggleBtn(true)}>Tree</button>
            <button type="button" style={s.toggleBtn(false)}>Graph</button>
          </span>
        </div>

        {/* Symbol tree */}
        <div style={s.treeWrap}>
          {blast.downstream.map((impact, idx) => (
            <SymbolImpact key={idx} impact={impact} />
          ))}
        </div>

        {/* Prior PRs collapsible */}
        {priorCount > 0 && (
          <div>
            <div style={s.priorPrsToggle} onClick={() => setPriorOpen((o) => !o)}>
              <Icon.GitPullRequest size={12} />
              Prior PRs touching these files
              <span
                style={{
                  marginLeft: 4,
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "0 6px",
                  fontSize: 11,
                }}
              >
                {priorCount}
              </span>
              <Icon.ChevronDown
                size={12}
                style={{
                  marginLeft: "auto",
                  transform: priorOpen ? "rotate(180deg)" : "none",
                  transition: "transform .15s",
                }}
              />
            </div>
            {priorOpen &&
              history.history.map((h, i) => (
                <div key={i} style={s.priorPrItem}>
                  <div style={s.priorPrTitle}>#{h.pr_number} {h.title}</div>
                  <div style={s.priorPrMeta}>
                    <span>{h.author}</span>
                    <span>merged {new Date(h.merged_at).toLocaleDateString()}</span>
                    <span>{h.files_overlap.length} shared file{h.files_overlap.length !== 1 ? "s" : ""}</span>
                  </div>
                  {h.notes && (
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                      {h.notes}
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SymbolImpact({ impact }: { impact: DownstreamImpact }) {
  const [expanded, setExpanded] = React.useState(true);

  return (
    <div>
      <div
        style={{ ...s.symbolRow, cursor: "pointer" }}
        onClick={() => setExpanded((e) => !e)}
      >
        <Icon.ChevronRight
          size={12}
          style={{
            color: "var(--text-muted)",
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform .1s",
            flexShrink: 0,
          }}
        />
        <span style={s.symbolName}>{impact.symbol}</span>
        <span style={s.callerCount}>
          {impact.callers.length} caller{impact.callers.length !== 1 ? "s" : ""}
        </span>
      </div>
      {expanded && (
        <>
          <div style={s.callerLines}>
            {impact.callers.map((c, i) => (
              <span key={i} style={s.callerLine}>
                <Icon.CornerDownRight size={10} style={{ color: "var(--border)" }} />
                {c.file}:{c.line}
              </span>
            ))}
          </div>
          {impact.endpoints_affected.length > 0 && (
            <div style={s.endpointBadgeRow}>
              {impact.endpoints_affected.map((ep, i) => {
                const { method, path } = httpMethod(ep);
                return method ? (
                  <span key={i} style={s.httpBadge(method)}>
                    {method} {path}
                  </span>
                ) : (
                  <span key={i} style={s.httpBadge("OTHER")}>{ep}</span>
                );
              })}
            </div>
          )}
          {impact.crons_affected.length > 0 && (
            <div style={s.endpointBadgeRow}>
              {impact.crons_affected.map((cr, i) => (
                <span key={i} style={s.cronBadge}>
                  <Icon.Clock size={9} />
                  {cr}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---- OverviewTab ------------------------------------------------------------

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null | undefined;
  runs?: ReviewRecord[];
  costUsd?: number | null;
}

export function OverviewTab({ prBody, prId, runs = [], costUsd }: OverviewTabProps) {
  const { data: brief } = usePrBrief(prId);

  const latest = runs[0] ?? null;
  const blockers = latest
    ? latest.findings.filter((f) => f.severity === "CRITICAL" && !f.dismissed_at).length
    : 0;

  return (
    <>
      {/* PR Brief: VerdictBanner from most recent review */}
      {latest?.verdict && (
        <section>
          <SectionLabel icon="FileText">PR Brief</SectionLabel>
          <VerdictBanner
            verdict={latest.verdict}
            summary={latest.summary}
            score={latest.score}
            findingsCount={latest.findings.length}
            blockers={blockers}
            costUsd={costUsd}
          />
        </section>
      )}

      {/* Intent + Blast Radius cards — populated by seeded demo data or future pipeline */}
      {brief ? (
        <div style={s.cardGrid}>
          <IntentCard brief={brief} />
          <BlastRadiusCard brief={brief} />
        </div>
      ) : latest?.verdict ? (
        <div style={s.cardGrid}>
          {(["Intent", "Blast radius"] as const).map((label) => (
            <div key={label} style={{ ...s.card, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 120, color: "var(--text-muted)", fontSize: 13 }}>
              <Icon.Clock size={18} style={{ opacity: 0.4 }} />
              <span><strong>{label}</strong> analysis not generated for this PR.</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Original PR description */}
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
