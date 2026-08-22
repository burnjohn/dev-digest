"use client";

import React from "react";
import ReactDOM from "react-dom";
import { usePrReviews } from "@/lib/hooks/reviews";
import type { FindingRecord } from "@devdigest/shared";

const SEV = {
  CRITICAL:   { symbol: "⊘", color: "var(--crit)" },
  WARNING:    { symbol: "△", color: "var(--warn)" },
  SUGGESTION: { symbol: "♦", color: "var(--ok)" },
} as const;

const chipStyle = (color: string): React.CSSProperties => ({
  fontSize: 11,
  fontWeight: 600,
  color,
  fontVariantNumeric: "tabular-nums",
  userSelect: "none",
});

const findingRowStyle: React.CSSProperties = {
  padding: "6px 12px",
  fontSize: 12,
  borderBottom: "1px solid var(--border)",
  display: "flex",
  gap: 6,
  alignItems: "flex-start",
};

function FindingRow({ f }: { f: FindingRecord }) {
  const sev = SEV[f.severity];
  return (
    <div style={findingRowStyle}>
      <span style={{ color: sev.color, fontWeight: 700, flexShrink: 0, fontSize: 13 }}>{sev.symbol}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", marginBottom: 2 }}>{f.title}</div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{f.rationale}</div>
        <div className="mono" style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{f.file}:{f.start_line}</div>
      </div>
    </div>
  );
}

function Popover({
  prId,
  anchorRect,
  onClose,
}: {
  prId: string;
  anchorRect: DOMRect;
  onClose: () => void;
}) {
  const { data: reviews, isLoading } = usePrReviews(prId);
  const ref = React.useRef<HTMLDivElement>(null);
  const findings: FindingRecord[] = reviews?.[0]?.findings ?? [];

  // Close on outside click
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Position below the anchor, aligned to its left edge
  const top = anchorRect.bottom + window.scrollY + 6;
  const left = Math.min(anchorRect.left + window.scrollX, window.innerWidth - 416);

  const style: React.CSSProperties = {
    position: "absolute",
    top,
    left,
    zIndex: 9999,
    width: 400,
    maxHeight: 320,
    overflowY: "auto",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
    padding: "4px 0",
  };

  return ReactDOM.createPortal(
    <div ref={ref} style={style} onClick={(e) => e.stopPropagation()}>
      <div style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
        {isLoading ? "Loading…" : `${findings.length} FINDINGS`}
      </div>
      {!isLoading && findings.length === 0 && (
        <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-muted)" }}>No findings yet — run a review first.</div>
      )}
      {findings.map((f) => <FindingRow key={f.id} f={f} />)}
    </div>,
    document.body,
  );
}

export function FindingsSeverityBadge({
  prId,
  critical,
  warning,
  suggestion,
}: {
  prId: string;
  critical?: number | null;
  warning?: number | null;
  suggestion?: number | null;
}) {
  const [anchorRect, setAnchorRect] = React.useState<DOMRect | null>(null);
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const hasData = critical != null || warning != null || suggestion != null;

  if (!hasData) return null;

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (anchorRect) {
      setAnchorRect(null);
    } else {
      setAnchorRect(triggerRef.current?.getBoundingClientRect() ?? null);
    }
  };

  return (
    <>
      <div
        ref={triggerRef}
        onClick={toggle}
        style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer" }}
      >
        {(critical ?? 0) > 0 && (
          <span style={chipStyle(SEV.CRITICAL.color)}>{SEV.CRITICAL.symbol}{critical}</span>
        )}
        {(warning ?? 0) > 0 && (
          <span style={chipStyle(SEV.WARNING.color)}>{SEV.WARNING.symbol}{warning}</span>
        )}
        {(suggestion ?? 0) > 0 && (
          <span style={chipStyle(SEV.SUGGESTION.color)}>{SEV.SUGGESTION.symbol}{suggestion}</span>
        )}
        {(critical ?? 0) === 0 && (warning ?? 0) === 0 && (suggestion ?? 0) === 0 && (
          <span style={{ fontSize: 11, color: "var(--ok)" }}>✓</span>
        )}
      </div>

      {anchorRect && (
        <Popover
          prId={prId}
          anchorRect={anchorRect}
          onClose={() => setAnchorRect(null)}
        />
      )}
    </>
  );
}
