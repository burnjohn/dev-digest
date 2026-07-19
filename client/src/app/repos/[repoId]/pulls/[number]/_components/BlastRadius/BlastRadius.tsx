/* BlastRadius — Blast Radius viewer (A3, L04).
   Colocated under the PR-detail route. Tree (default) + graph (drill-in) over a
   BlastRadius from GET /pulls/:id/blast, enriched with deterministic reviewer
   signals (no model call): caller roles, call-site risk (loop/unguarded),
   breaking API changes, existing-finding cross-reference, dead symbols, related
   PRs. Public export name: BlastRadiusView. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, MonoLink, SEV } from "@devdigest/ui";
import type { BlastRadius, DownstreamImpact, CallerRole, Severity } from "@devdigest/shared";
import { BLAST_VIEWS, GRAPH, ROLE_META, STAT_ICONS, type BlastView } from "./constants";
import { blastCounts, isEmptyBlast } from "./helpers";
import { s } from "./styles";

/** A compact icon+label chip used for the call-site / breaking risk markers. */
function Chip({ icon, color, label, title }: { icon: keyof typeof Icon; color: string; label: string; title: string }) {
  const I = Icon[icon];
  return (
    <span title={title} style={s.chip(color)}>
      {I && <I size={11} />}
      {label}
    </span>
  );
}

/** Small role pill (business / test / boilerplate); `normal` renders nothing. */
function RoleTag({ role }: { role: CallerRole }) {
  const t = useTranslations("blast");
  if (!ROLE_META[role].tag) return null;
  return (
    <span title={t(`roleHelp.${role}`)} style={s.roleTag(ROLE_META[role].color)}>
      {t(`role.${role}`)}
    </span>
  );
}

/** Cross-reference badge: existing agent finding(s) landing on this changed code. */
function FindingBadge({ severity, count }: { severity: Severity; count: number }) {
  const t = useTranslations("blast");
  const sev = SEV[severity];
  const I = Icon[sev.icon as keyof typeof Icon];
  return (
    <span title={t("findingHelp", { count, severity: sev.label })} style={s.findingBadge(sev.c, sev.bg)}>
      {I && <I size={11} />}
      {t("finding", { count })}
    </span>
  );
}

function Summary({ blast }: { blast: BlastRadius }) {
  const t = useTranslations("blast");
  const counts = blastCounts(blast);
  const Stat = ({ icon, n, label, help }: { icon: keyof typeof Icon; n: number; label: string; help: string }) => {
    const I = Icon[icon];
    return (
      <span style={s.stat} title={help}>
        <I size={13} style={s.statIcon} />
        <b className="tnum" style={s.statValue}>
          {n}
        </b>
        {label}
      </span>
    );
  };
  return (
    <div style={s.summary}>
      {STAT_ICONS.map((stat) => (
        <Stat
          key={stat.key}
          icon={stat.icon}
          n={counts[stat.key as keyof typeof counts]}
          label={t(`stat.${stat.key}`)}
          help={t(`statHelp.${stat.key}`)}
        />
      ))}
    </div>
  );
}

/** Highest alert level for a symbol row → drives the left-accent highlight. */
function nodeAlert(d: DownstreamImpact): "crit" | "warn" | null {
  if (d.finding_severity === "CRITICAL") return "crit";
  if (d.breaking && d.endpoints_affected.length > 0) return "crit"; // breaking a live endpoint
  if (d.breaking || d.may_throw || d.finding_severity) return "warn";
  return null;
}

function DownstreamNode({
  d,
  open,
  onToggle,
  onWhy,
}: {
  d: DownstreamImpact;
  open: boolean;
  onToggle: () => void;
  onWhy?: (file: string, line: number) => void;
}) {
  const t = useTranslations("blast");
  const alert = nodeAlert(d);
  return (
    <div style={s.node}>
      <div
        onClick={onToggle}
        style={s.nodeHeader(open, alert)}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <Icon.ChevronRight size={13} style={s.chevron(open)} />
        <Icon.Code size={13} style={s.nodeIcon} />
        <span className="mono" style={s.nodeSymbol}>
          {d.symbol}()
        </span>
        {d.breaking && (
          <Chip icon="AlertOctagon" color="var(--crit)" label={t("risk.breaking")} title={t("riskHelp.breaking")} />
        )}
        {d.finding_severity && <FindingBadge severity={d.finding_severity} count={d.finding_count} />}
        {d.may_throw && (
          <Chip icon="AlertTriangle" color="var(--warn)" label={t("risk.throws")} title={t("riskHelp.throws")} />
        )}
        <span style={s.nodeCallerCount}>{t("callerCount", { count: d.callers.length })}</span>
      </div>
      {open && (
        <div style={s.callerList}>
          {d.callers.map((c, ci) => {
            const loc = `${c.file}:${c.line}`;
            return (
              <div key={ci} style={s.callerRow}>
                <Icon.CornerDownRight size={13} style={s.callerIcon} />
                <span style={{ ...s.callerName, color: ROLE_META[c.role].color }}>{c.name}</span>
                <RoleTag role={c.role} />
                <span style={s.callerLink} title={onWhy ? t("openCode", { loc }) : undefined}>
                  <MonoLink onClick={onWhy ? () => onWhy(c.file, c.line) : undefined}>{loc}</MonoLink>
                  {onWhy && <Icon.ExternalLink size={12} style={s.openHint} aria-hidden />}
                </span>
                {c.in_loop && (
                  <Chip icon="Zap" color="var(--warn)" label={t("risk.loop")} title={t("riskHelp.loop")} />
                )}
                {c.unguarded && d.may_throw && (
                  <Chip
                    icon="AlertTriangle"
                    color="var(--warn)"
                    label={t("risk.unguarded")}
                    title={t("riskHelp.unguarded")}
                  />
                )}
              </div>
            );
          })}
          {d.endpoints_affected.length > 0 && (
            <div style={s.badgeRow}>
              {d.endpoints_affected.map((e, ei) => (
                <span key={ei} title={t("badgeHelp.endpoint")} style={s.badgeWrap}>
                  <Badge mono icon="Globe" color="var(--accent-text)" bg="var(--accent-bg)">
                    {e}
                  </Badge>
                </span>
              ))}
            </div>
          )}
          {d.crons_affected.length > 0 && (
            <div style={s.cronBadgeRow}>
              {d.crons_affected.map((e, ei) => (
                <span key={ei} title={t("badgeHelp.cron")} style={s.badgeWrap}>
                  <Badge mono icon="Clock" color="var(--warn)" bg="var(--warn-bg)">
                    {e}
                  </Badge>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Changed symbols that nothing external calls — possibly dead / internal-only. */
function DeadSymbols({ blast }: { blast: BlastRadius }) {
  const t = useTranslations("blast");
  if (blast.dead_symbols.length === 0) return null;
  return (
    <div style={s.deadSection}>
      <div style={s.deadTitle} title={t("dead.help")}>
        <Icon.EyeOff size={12} />
        {t("dead.title")}
      </div>
      {blast.dead_symbols.map((sym, i) => (
        <div key={i} style={s.deadRow}>
          <Icon.Code size={13} style={s.deadIcon} />
          <span className="mono" style={s.deadName}>
            {sym.name}()
          </span>
          <span style={s.deadTag}>{t("dead.tag")}</span>
        </div>
      ))}
    </div>
  );
}

/** Collapsible "Prior PRs touching these files" (recency context). */
function RelatedPrs({ blast, repoHref }: { blast: BlastRadius; repoHref?: (n: number) => string }) {
  const t = useTranslations("blast");
  const [open, setOpen] = React.useState(false);
  if (blast.related_prs.length === 0) return null;
  return (
    <div style={s.relatedSection}>
      <div onClick={() => setOpen((o) => !o)} style={s.relatedHeader} role="button" tabIndex={0}>
        <Icon.History size={13} style={s.relatedIcon} />
        <span style={s.relatedTitle}>{t("related.title")}</span>
        <span style={s.relatedCount}>{blast.related_prs.length}</span>
        <Icon.ChevronDown size={14} style={s.chevron(open)} />
      </div>
      {open && (
        <div style={s.relatedList}>
          {blast.related_prs.map((pr) => (
            <div key={pr.id} style={s.relatedRow}>
              <span style={s.relatedNum}>#{pr.number}</span>
              {repoHref ? (
                <MonoLink onClick={() => window.open(repoHref(pr.number), "_blank", "noopener")}>{pr.title}</MonoLink>
              ) : (
                <span style={s.relatedPrTitle}>{pr.title}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Small color/role key so the tree's colors + risk chips are self-explanatory. */
function GraphLegend() {
  const t = useTranslations("blast");
  const item = (color: string, label: string) => (
    <span style={s.legendItem} key={label}>
      <span style={{ ...s.legendSwatch, borderColor: color }} />
      {label}
    </span>
  );
  return (
    <div style={s.legend}>
      {item("var(--accent)", t("legend.changed"))}
      {item("var(--border-strong)", t("legend.caller"))}
      {item("var(--warn)", t("legend.endpoint"))}
    </div>
  );
}

/** Hierarchical node-link SVG drill-in for the first downstream symbol. */
function BlastGraph({ blast }: { blast: BlastRadius }) {
  const t = useTranslations("blast");
  const d = blast.downstream[0];
  if (!d || d.callers.length === 0) {
    return <div style={s.graphEmpty}>{t("graph.empty")}</div>;
  }
  const H = Math.max(GRAPH.minHeight, 60 + d.callers.length * GRAPH.rowGap);
  const root = { x: GRAPH.rootX, y: H / 2, label: `${d.symbol}()` };
  const denom = Math.max(1, d.callers.length - 1);
  const callerNodes = d.callers.map((c, i) => ({
    x: GRAPH.callerX,
    y: 38 + i * ((H - 70) / denom),
    label: c.name,
    color: ROLE_META[c.role].color,
  }));
  const epNodes = d.endpoints_affected.map((e, i) => ({ x: GRAPH.endpointX, y: 50 + i * 48, label: e }));

  const edge = (a: { x: number; y: number }, b: { x: number; y: number }, key: string, color?: string) => (
    <path
      key={key}
      d={`M${a.x + 4},${a.y} C${(a.x + b.x) / 2},${a.y} ${(a.x + b.x) / 2},${b.y} ${b.x - 4},${b.y}`}
      fill="none"
      stroke={color ?? "var(--border-strong)"}
      strokeWidth={1.5}
    />
  );
  const node = (n: { x: number; y: number; label: string }, color: string, w: number = GRAPH.nodeWidth) => (
    <g key={n.label} transform={`translate(${n.x - w / 2},${n.y - 13})`}>
      <rect width={w} height={26} rx={6} fill="var(--bg-elevated)" stroke={color} strokeWidth={1.25}>
        <title>{n.label}</title>
      </rect>
      <text x={w / 2} y={17} textAnchor="middle" fontSize={11} fill="var(--text-primary)" className="mono">
        {n.label}
      </text>
    </g>
  );

  return (
    <div style={s.graphWrap}>
      <GraphLegend />
      <svg width={GRAPH.width} height={H} style={s.graphSvg} role="img" aria-label={t("graph.ariaLabel")}>
        {callerNodes.map((c, i) => edge(root, c, `r-${i}`, "var(--accent)"))}
        {epNodes.map((e, i) => edge(callerNodes[Math.min(i, callerNodes.length - 1)]!, e, `e-${i}`))}
        {node(root, "var(--accent)")}
        {callerNodes.map((c) => node(c, c.color))}
        {epNodes.map((e) => node(e, "var(--warn)", GRAPH.endpointNodeWidth))}
      </svg>
    </div>
  );
}

export interface BlastRadiusViewProps {
  blast: BlastRadius;
  /** Optional git-why hook: clicking a caller location fires this. */
  onWhy?: (file: string, line: number) => void;
  /** Optional: build a link to a related PR by number. */
  relatedPrHref?: (n: number) => string;
}

export function BlastRadiusView({ blast, onWhy, relatedPrHref }: BlastRadiusViewProps) {
  const t = useTranslations("blast");
  const [view, setView] = React.useState<BlastView>("tree");
  // Keyed by index, not symbol — downstream can contain the same symbol twice
  // (e.g. "CompletionResult"), which would collide as a React key and share toggle state.
  const [open, setOpen] = React.useState<Record<number, boolean>>((): Record<number, boolean> =>
    blast.downstream[0] ? { 0: true } : {},
  );

  const setAll = (value: boolean) =>
    setOpen(Object.fromEntries(blast.downstream.map((_, i) => [i, value])));
  const allOpen = blast.downstream.length > 0 && blast.downstream.every((_, i) => open[i]);

  if (isEmptyBlast(blast)) {
    return <div style={s.emptySummary}>{blast.summary}</div>;
  }

  return (
    <div style={s.root}>
      <div style={s.headerRow}>
        <Summary blast={blast} />
        <div style={s.viewToggle}>
          {BLAST_VIEWS.map((v) => (
            <button key={v} onClick={() => setView(v)} style={s.toggleBtn(view === v)} title={t(`viewHelp.${v}`)}>
              {t(`view.${v}`)}
            </button>
          ))}
        </div>
      </div>
      <div style={s.summaryText}>{blast.summary}</div>
      {!blast.findings_available && <div style={s.notReviewed}>{t("notReviewed")}</div>}
      {view === "tree" ? (
        <div style={s.tree}>
          {blast.downstream.length === 0 ? (
            <div style={s.treeEmpty}>{t("noDownstream", { count: blast.changed_symbols.length })}</div>
          ) : (
            <>
              <div style={s.treeControls}>
                <Icon.Info size={12} style={s.hintIcon} />
                <span style={s.hint}>{t("hint")}</span>
                {blast.downstream.length > 1 && (
                  <button
                    onClick={() => setAll(!allOpen)}
                    style={s.textBtn}
                    title={allOpen ? t("collapseAll") : t("expandAll")}
                  >
                    <Icon.ChevronsUpDown size={12} />
                    {allOpen ? t("collapseAll") : t("expandAll")}
                  </button>
                )}
              </div>
              {blast.downstream.map((d, i) => (
                <DownstreamNode
                  key={`${d.symbol}-${i}`}
                  d={d}
                  open={!!open[i]}
                  onToggle={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}
                  onWhy={onWhy}
                />
              ))}
            </>
          )}
          <DeadSymbols blast={blast} />
          <RelatedPrs blast={blast} repoHref={relatedPrHref} />
        </div>
      ) : (
        <BlastGraph blast={blast} />
      )}
    </div>
  );
}

export default BlastRadiusView;
