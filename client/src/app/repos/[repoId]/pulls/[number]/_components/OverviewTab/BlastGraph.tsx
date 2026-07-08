"use client";

/**
 * BlastGraph — React Flow-powered graph view for the Blast Radius card.
 * Dynamic-imported (ssr: false) from BlastRadiusCard to keep React Flow out of the initial bundle.
 *
 * Layout: 3-column hand-computed (no dagre/elk)
 *   Column 1 (x=60):  changed symbols  — accent-blue border, monospace `name()`
 *   Column 2 (x=340): caller names     — deduplicated by BlastCaller.name, monospace
 *   Column 3 (x=620): endpoint/cron    — capsule badges, blue/amber
 *
 * Edges: smooth bezier, muted, no arrowheads, no animation.
 * No Background grid, no Controls panel — pan/zoom via gestures only.
 *
 * Node click:
 *   - Symbol nodes  → GitHub blob URL of the declared file (no line)
 *   - Caller nodes  → GitHub blob URL of the first occurrence's file:line
 *   - Endpoint/cron → no-op (never clickable)
 *
 * Cap: if total nodes > 60, callers are truncated proportionally; a single
 * muted "+N more" node is appended to column 2.
 *
 * Legend row: rendered below the canvas (not inside React Flow).
 */

import "@xyflow/react/dist/style.css";
import React, { useMemo } from "react";
import { ReactFlow, Handle, Position } from "@xyflow/react";
import { useTranslations } from "next-intl";
import type { BlastRadius, BlastLink } from "@devdigest/shared";
import { formatCron } from "./cron";

// ---- Layout constants --------------------------------------------------------

const COL_X = [60, 340, 620] as const;
const ROW_SPACING = 70;
const MAX_NODES = 60;

// ---- Node style constants (matching the tree's color tokens) -----------------

/** Symbol node: accent-blue border, dark surface, monospace bold */
const SYMBOL_NODE: React.CSSProperties = {
  borderRadius: 8,
  border: "1px solid #60a5fa",           // same blue as the endpoint/active-toggle palette
  background: "var(--bg-elevated)",
  color: "var(--text-primary)",
  fontFamily: "var(--font-mono, monospace)",
  fontSize: 11,
  fontWeight: 700,
  padding: "5px 10px",
  maxWidth: 200,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  cursor: "default",
};

/** Caller node: dark surface, subtle border, monospace, pointer cursor */
const CALLER_NODE: React.CSSProperties = {
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg-surface)",
  color: "var(--text-secondary)",
  fontFamily: "var(--font-mono, monospace)",
  fontSize: 11,
  padding: "5px 10px",
  maxWidth: 200,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  cursor: "pointer",
};

/** Endpoint node: blue capsule — color encodes TYPE (HTTP endpoint), matches
 *  the tree's httpBadge. Cron nodes use the amber CRON_NODE. */
const ENDPOINT_NODE: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid rgba(59,130,246,0.35)",
  background: "rgba(59,130,246,0.12)",
  color: "#60a5fa",
  fontFamily: "var(--font-mono, monospace)",
  fontSize: 11,
  fontWeight: 600,
  padding: "4px 10px",
  maxWidth: 150,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  cursor: "default",
};

/** Cron node: amber capsule — matches cronBadge in tree */
const CRON_NODE: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid rgba(245,158,11,0.35)",
  background: "rgba(245,158,11,0.12)",
  color: "var(--warn)",
  fontFamily: "var(--font-mono, monospace)",
  fontSize: 11,
  fontWeight: 600,
  padding: "4px 10px",
  maxWidth: 150,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  cursor: "default",
};

/** "+N more" muted overflow summary node */
const MORE_NODE: React.CSSProperties = {
  borderRadius: 8,
  border: "1px dashed var(--border)",
  background: "transparent",
  color: "var(--text-muted)",
  fontFamily: "var(--font-mono, monospace)",
  fontSize: 10,
  fontStyle: "italic",
  padding: "4px 10px",
  cursor: "default",
};

// ---- Shared edge style (no arrowheads) ---------------------------------------
// More visible than the near-invisible `--border`, but still a restrained,
// slate-toned line consistent with the dark card — not a loud accent.

const EDGE_STYLE: React.CSSProperties = {
  stroke: "var(--text-muted)",
  strokeWidth: 1.75,
  strokeOpacity: 0.7,
};

// ---- URL helpers -------------------------------------------------------------

function ghBlobUrl(link: BlastLink, file: string, line?: number): string {
  const base = `https://github.com/${link.owner}/${link.repo}/blob/${link.head_sha}/${encodeURI(file)}`;
  return line ? `${base}#L${line}` : base;
}

// ---- React Flow custom node --------------------------------------------------

type NodeStyle = "symbol" | "caller" | "endpoint" | "cron" | "more";

interface NodeData extends Record<string, unknown> {
  label: string;
  nodeStyle: NodeStyle;
  href?: string;
  /** Hover tooltip; falls back to `label`. Used to keep the raw cron expr. */
  title?: string;
}

function styleForKind(kind: NodeStyle): React.CSSProperties {
  switch (kind) {
    case "symbol":   return SYMBOL_NODE;
    case "caller":   return CALLER_NODE;
    case "endpoint": return ENDPOINT_NODE;
    case "cron":     return CRON_NODE;
    case "more":     return MORE_NODE;
  }
}

/**
 * Invisible connection handles. React Flow SILENTLY DROPS every edge whose
 * source/target node has no <Handle> — custom node types must render them
 * even when connections are display-only.
 */
const HIDDEN_HANDLE: React.CSSProperties = {
  opacity: 0,
  pointerEvents: "none",
  width: 1,
  height: 1,
  minWidth: 1,
  minHeight: 1,
  border: "none",
  background: "transparent",
};

const CustomNode = React.memo(function CustomNode({ data }: { data: NodeData }) {
  const style = styleForKind(data.nodeStyle);

  function handleClick() {
    if (data.href) {
      window.open(data.href, "_blank", "noopener,noreferrer");
    }
  }

  const label =
    data.nodeStyle === "symbol"
      ? `${data.label}()`   // monospace `name()` motif for changed symbols
      : data.label;

  return (
    <div
      style={style}
      onClick={data.href ? handleClick : undefined}
      title={data.title ?? data.label}
    >
      <Handle type="target" position={Position.Left} style={HIDDEN_HANDLE} isConnectable={false} />
      {label}
      <Handle type="source" position={Position.Right} style={HIDDEN_HANDLE} isConnectable={false} />
    </div>
  );
});

const NODE_TYPES = { custom: CustomNode };

// ---- Legend ------------------------------------------------------------------

const LEGEND_DOT_BASE: React.CSSProperties = {
  display: "inline-block",
  width: 8,
  height: 8,
  borderRadius: "50%",
  marginRight: 4,
  verticalAlign: "middle",
};

// ---- Props ------------------------------------------------------------------

interface BlastGraphProps {
  blast: BlastRadius;
  link?: BlastLink | null;
  /** cron value → declaring file(s), for labelling cron nodes by file name.
   *  Same map the Tree view uses so a cron reads identically in both. */
  cronFiles?: Record<string, string[]>;
}

// ---- Component --------------------------------------------------------------

export function BlastGraph({ blast, link, cronFiles }: BlastGraphProps) {
  const t = useTranslations("blast");

  const totalCallers = blast.downstream.reduce((s, d) => s + d.callers.length, 0);
  const hasNoDownstream = totalCallers === 0;

  const { nodes, edges } = useMemo(() => {
    if (hasNoDownstream) return { nodes: [], edges: [] };

    const rfNodes: import("@xyflow/react").Node<NodeData>[] = [];
    const rfEdges: import("@xyflow/react").Edge[] = [];

    // ---- Column 2: deduplicate callers by NAME (not by file) ----------------
    //
    // The design shows caller symbol names (e.g. `publicRouter`, `app`) in
    // column 2. We dedup by BlastCaller.name across all downstream entries.
    // For click, we record the first file+line occurrence for that name.
    const callerNameMap = new Map<string, { file: string; line: number }>();
    for (const d of blast.downstream) {
      for (const c of d.callers) {
        if (!callerNameMap.has(c.name)) {
          callerNameMap.set(c.name, { file: c.file, line: c.line });
        }
      }
    }

    // ---- Column 3: deduplicate endpoints and crons --------------------------
    const endpointSet = new Map<string, number>();
    const cronSet = new Map<string, number>();
    for (const d of blast.downstream) {
      for (const ep of d.endpoints_affected) {
        if (!endpointSet.has(ep)) endpointSet.set(ep, endpointSet.size);
      }
      for (const cr of d.crons_affected) {
        if (!cronSet.has(cr)) cronSet.set(cr, cronSet.size);
      }
    }

    const col3Count = endpointSet.size + cronSet.size;
    const totalNodeCount = blast.downstream.length + callerNameMap.size + col3Count;

    // ---- Proportional truncation when total > MAX_NODES ----------------------
    let truncationSummary: string | null = null;
    let callerNamesToRender = callerNameMap;

    if (totalNodeCount > MAX_NODES) {
      const callerBudget = Math.max(0, MAX_NODES - blast.downstream.length - col3Count - 1); // -1 for "+N more"
      if (callerBudget < callerNameMap.size) {
        const extraCount = callerNameMap.size - callerBudget;
        const truncated = new Map<string, { file: string; line: number }>();
        let i = 0;
        for (const [name, ref] of callerNameMap) {
          if (i >= callerBudget) break;
          truncated.set(name, ref);
          i++;
        }
        callerNamesToRender = truncated;
        truncationSummary = t("more", { count: extraCount });
      }
    }

    // ---- Column 1: symbol nodes ---------------------------------------------
    blast.downstream.forEach((d, si) => {
      const y = si * ROW_SPACING + 20;
      const sym = blast.changed_symbols.find((s) => s.name === d.symbol);
      rfNodes.push({
        id: `sym-${si}`,
        type: "custom",
        position: { x: COL_X[0], y },
        data: {
          label: d.symbol,
          nodeStyle: "symbol",
          href: link && sym ? ghBlobUrl(link, sym.file) : undefined,
        },
      });
    });

    // ---- Column 2: caller name nodes ----------------------------------------
    let callerIdx = 0;
    for (const [name, ref] of callerNamesToRender) {
      const y = callerIdx * ROW_SPACING + 20;
      rfNodes.push({
        id: `caller-${name}`,
        type: "custom",
        position: { x: COL_X[1], y },
        data: {
          label: name,
          nodeStyle: "caller",
          href: link ? ghBlobUrl(link, ref.file, ref.line) : undefined,
        },
      });
      callerIdx++;
    }

    // "+N more" summary node
    if (truncationSummary) {
      rfNodes.push({
        id: "more",
        type: "custom",
        position: { x: COL_X[1], y: callerIdx * ROW_SPACING + 20 },
        data: { label: truncationSummary, nodeStyle: "more" },
      });
    }

    // ---- Column 3: endpoint + cron nodes ------------------------------------
    let col3Idx = 0;
    for (const [ep] of endpointSet) {
      rfNodes.push({
        id: `ep-${ep}`,
        type: "custom",
        position: { x: COL_X[2], y: col3Idx * ROW_SPACING + 20 },
        data: { label: ep, nodeStyle: "endpoint" },
      });
      col3Idx++;
    }
    for (const [cr] of cronSet) {
      rfNodes.push({
        id: `cron-${cr}`,
        type: "custom",
        position: { x: COL_X[2], y: col3Idx * ROW_SPACING + 20 },
        // Same human-readable label as the Tree view (e.g. `app (every 15
        // min)`); raw expression kept as the hover title.
        data: { label: formatCron(cr, cronFiles?.[cr]), nodeStyle: "cron", title: cr },
      });
      col3Idx++;
    }

    // ---- Edges: symbol → caller (by name), caller → endpoint/cron ----------
    //
    // For each downstream symbol, connect it to every caller name appearing in
    // its callers list. Then connect each rendered caller name to the
    // endpoints/crons of the symbol(s) that reference it.

    const symCallerEdges = new Set<string>();
    const callerEpEdges = new Set<string>();

    blast.downstream.forEach((d, si) => {
      // unique caller names for this symbol
      const callerNamesForSymbol = [...new Set(d.callers.map((c) => c.name))];

      for (const name of callerNamesForSymbol) {
        if (!callerNamesToRender.has(name)) continue; // truncated
        const edgeKey = `sym-${si}→${name}`;
        if (symCallerEdges.has(edgeKey)) continue;
        symCallerEdges.add(edgeKey);
        rfEdges.push({
          id: edgeKey,
          source: `sym-${si}`,
          target: `caller-${name}`,
          type: "default",
          style: EDGE_STYLE,
          markerEnd: undefined,    // no arrowhead
          animated: false,
        });
      }

      for (const name of callerNamesForSymbol) {
        if (!callerNamesToRender.has(name)) continue;
        for (const ep of d.endpoints_affected) {
          const key = `${name}→ep-${ep}`;
          if (callerEpEdges.has(key)) continue;
          callerEpEdges.add(key);
          rfEdges.push({
            id: key,
            source: `caller-${name}`,
            target: `ep-${ep}`,
            type: "default",
            style: EDGE_STYLE,
            markerEnd: undefined,
            animated: false,
          });
        }
        for (const cr of d.crons_affected) {
          const key = `${name}→cron-${cr}`;
          if (callerEpEdges.has(key)) continue;
          callerEpEdges.add(key);
          rfEdges.push({
            id: key,
            source: `caller-${name}`,
            target: `cron-${cr}`,
            type: "default",
            style: EDGE_STYLE,
            markerEnd: undefined,
            animated: false,
          });
        }
      }
    });

    return { nodes: rfNodes, edges: rfEdges };
  }, [blast, link, cronFiles, hasNoDownstream, t]);

  if (hasNoDownstream) {
    return (
      <div
        style={{
          height: 360,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-muted)",
          fontSize: 13,
          fontStyle: "italic",
        }}
        aria-label={t("graph.ariaLabel")}
      >
        {t("graph.empty")}
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          height: 360,
          borderRadius: 8,
          overflow: "hidden",
          background: "transparent",
        }}
        aria-label={t("graph.ariaLabel")}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          nodesDraggable={false}
          nodesConnectable={false}
          panOnDrag={true}
          fitView
          proOptions={{ hideAttribution: true }}
          style={{ background: "transparent" }}
          // Suppress default edge markers — we want no arrowheads
          defaultEdgeOptions={{ markerEnd: undefined, animated: false }}
        />
      </div>
      {/* Legend row */}
      <div
        style={{
          display: "flex",
          gap: 16,
          padding: "6px 2px 2px",
          fontSize: 10,
          color: "var(--text-muted)",
        }}
      >
        <span>
          <span
            style={{ ...LEGEND_DOT_BASE, background: "#60a5fa" }}
            aria-hidden="true"
          />
          {t("legend.symbols")}
        </span>
        <span>
          <span
            style={{ ...LEGEND_DOT_BASE, background: "var(--text-muted)" }}
            aria-hidden="true"
          />
          {t("legend.callers")}
        </span>
        <span>
          <span
            style={{ ...LEGEND_DOT_BASE, background: "#60a5fa" }}
            aria-hidden="true"
          />
          {t("legend.endpoints")}
        </span>
      </div>
    </div>
  );
}
