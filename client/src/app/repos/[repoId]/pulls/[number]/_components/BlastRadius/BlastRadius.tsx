/* BlastRadius — Blast Radius viewer (A3, L04).
   Colocated under the PR-detail route. Tree (default) + graph (drill-in) over a
   BlastRadius from GET /pulls/:id/blast. Public export name: BlastRadiusView. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, MonoLink } from "@devdigest/ui";
import type { BlastRadius, DownstreamImpact } from "@devdigest/shared";
import { BLAST_VIEWS, GRAPH, STAT_ICONS, type BlastView } from "./constants";
import { blastCounts, isEmptyBlast } from "./helpers";
import { s } from "./styles";

function Summary({ blast }: { blast: BlastRadius }) {
  const t = useTranslations("blast");
  const counts = blastCounts(blast);
  const Stat = ({ icon, n, label }: { icon: keyof typeof Icon; n: number; label: string }) => {
    const I = Icon[icon];
    return (
      <span style={s.stat}>
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
        <Stat key={stat.key} icon={stat.icon} n={counts[stat.key as keyof typeof counts]} label={t(`stat.${stat.key}`)} />
      ))}
    </div>
  );
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
  return (
    <div style={s.node}>
      <div onClick={onToggle} style={s.nodeHeader(open)}>
        <Icon.ChevronRight size={13} style={s.chevron(open)} />
        <Icon.Code size={13} style={s.nodeIcon} />
        <span className="mono" style={s.nodeSymbol}>
          {d.symbol}()
        </span>
        <span style={s.nodeCallerCount}>{t("callerCount", { count: d.callers.length })}</span>
      </div>
      {open && (
        <div style={s.callerList}>
          {d.callers.map((c, ci) => (
            <div key={ci} style={s.callerRow}>
              <Icon.CornerDownRight size={13} style={s.callerIcon} />
              <span style={s.callerName}>{c.name}</span>
              <MonoLink onClick={onWhy ? () => onWhy(c.file, c.line) : undefined}>
                {c.file}:{c.line}
              </MonoLink>
            </div>
          ))}
          {d.endpoints_affected.length > 0 && (
            <div style={s.badgeRow}>
              {d.endpoints_affected.map((e, ei) => (
                <Badge key={ei} mono icon="Globe" color="var(--accent-text)" bg="var(--accent-bg)">
                  {e}
                </Badge>
              ))}
            </div>
          )}
          {d.crons_affected.length > 0 && (
            <div style={s.cronBadgeRow}>
              {d.crons_affected.map((e, ei) => (
                <Badge key={ei} mono icon="Clock" color="var(--warn)" bg="var(--warn-bg)">
                  {e}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
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
      <rect width={w} height={26} rx={6} fill="var(--bg-elevated)" stroke={color} strokeWidth={1.25} />
      <text x={w / 2} y={17} textAnchor="middle" fontSize={11} fill="var(--text-primary)" className="mono">
        {n.label}
      </text>
    </g>
  );

  return (
    <svg width={GRAPH.width} height={H} style={s.graphSvg} role="img" aria-label={t("graph.ariaLabel")}>
      {callerNodes.map((c, i) => edge(root, c, `r-${i}`, "var(--accent)"))}
      {epNodes.map((e, i) => edge(callerNodes[Math.min(i, callerNodes.length - 1)]!, e, `e-${i}`))}
      {node(root, "var(--accent)")}
      {callerNodes.map((c) => node(c, "var(--border-strong)"))}
      {epNodes.map((e) => node(e, "var(--warn)", GRAPH.endpointNodeWidth))}
    </svg>
  );
}

export interface BlastRadiusViewProps {
  blast: BlastRadius;
  /** Optional git-why hook: clicking a caller location fires this. */
  onWhy?: (file: string, line: number) => void;
}

export function BlastRadiusView({ blast, onWhy }: BlastRadiusViewProps) {
  const t = useTranslations("blast");
  const [view, setView] = React.useState<BlastView>("tree");
  // Keyed by index, not symbol — downstream can contain the same symbol twice
  // (e.g. "CompletionResult"), which would collide as a React key and share toggle state.
  const [open, setOpen] = React.useState<Record<number, boolean>>((): Record<number, boolean> =>
    blast.downstream[0] ? { 0: true } : {},
  );

  if (isEmptyBlast(blast)) {
    return <div style={s.emptySummary}>{blast.summary}</div>;
  }

  return (
    <div style={s.root}>
      <div style={s.headerRow}>
        <Summary blast={blast} />
        <div style={s.viewToggle}>
          {BLAST_VIEWS.map((v) => (
            <button key={v} onClick={() => setView(v)} style={s.toggleBtn(view === v)}>
              {t(`view.${v}`)}
            </button>
          ))}
        </div>
      </div>
      <div style={s.summaryText}>{blast.summary}</div>
      {view === "tree" ? (
        <div style={s.tree}>
          {blast.downstream.length === 0 ? (
            <div style={s.treeEmpty}>{t("noDownstream", { count: blast.changed_symbols.length })}</div>
          ) : (
            blast.downstream.map((d, i) => (
              <DownstreamNode
                key={`${d.symbol}-${i}`}
                d={d}
                open={!!open[i]}
                onToggle={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}
                onWhy={onWhy}
              />
            ))
          )}
        </div>
      ) : (
        <BlastGraph blast={blast} />
      )}
    </div>
  );
}

export default BlastRadiusView;
