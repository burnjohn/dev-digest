/* atoms — trivial presentational layout helpers shared by the trace body
   (Stat tile, labelled Row). Grouped in one file: no logic, never tested alone. */
import React from "react";
import { s } from "../styles";

// ---- HighlightedCode -------------------------------------------------------

const HL = 20; // line-height px — must match CodeEditor in skills ConfigTab

function hlLineColor(line: string): string {
  if (/^#{1,6}(\s|$)/.test(line)) return "var(--accent)";
  return "var(--text-secondary)";
}

export function HighlightedCode({ text, maxHeight }: { text: string; maxHeight?: number }) {
  const lines = (text || "—").split("\n");
  return (
    <div
      style={{
        display: "flex",
        borderTop: "1px solid var(--border)",
        fontFamily: "monospace",
        fontSize: 12.5,
        lineHeight: `${HL}px`,
        background: "var(--code-bg)",
        overflow: "auto",
        ...(maxHeight != null ? { maxHeight } : {}),
      }}
    >
      <div
        style={{
          flexShrink: 0,
          width: 36,
          padding: "10px 0",
          background: "rgba(0,0,0,0.18)",
          borderRight: "1px solid var(--border)",
          userSelect: "none" as const,
        }}
      >
        {lines.map((_, i) => (
          <div
            key={i}
            style={{
              height: HL,
              lineHeight: `${HL}px`,
              fontSize: 11,
              paddingRight: 8,
              color: "var(--text-muted)",
              textAlign: "right",
              opacity: 0.6,
            }}
          >
            {i + 1}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, padding: "10px 12px", minWidth: 0, overflow: "hidden" }}>
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              height: HL,
              lineHeight: `${HL}px`,
              color: hlLineColor(line),
              whiteSpace: "pre",
            }}
          >
            {line || "​"}
          </div>
        ))}
      </div>
    </div>
  );
}

export { hlLineColor };

export function Stat({ label, val }: { label: string; val: React.ReactNode }) {
  return (
    <div style={s.stat}>
      <div style={s.statLabel}>{label}</div>
      <div className="tnum" style={s.statVal}>
        {val}
      </div>
    </div>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={s.row}>
      <span style={s.rowLabel}>{label}</span>
      {children}
    </div>
  );
}
