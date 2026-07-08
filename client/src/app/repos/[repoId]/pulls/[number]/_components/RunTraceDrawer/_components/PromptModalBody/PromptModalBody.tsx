/* PromptModalBody — fullscreen modal body for a prompt block: monospace text +
   a line search. Fixed height so the modal stays stable even when the search
   finds nothing. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { TextInput } from "@devdigest/ui";
import { hlLineColor } from "../atoms";

/** Highlight every case-insensitive occurrence of `q` within a single line. */
function highlightLine(line: string, q: string): React.ReactNode {
  if (!q) return line;
  const lower = line.toLowerCase();
  const ql = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  while (i <= line.length) {
    const idx = lower.indexOf(ql, i);
    if (idx === -1) {
      parts.push(line.slice(i));
      break;
    }
    if (idx > i) parts.push(line.slice(i, idx));
    parts.push(
      <mark key={idx} style={{ background: "var(--accent)", color: "var(--bg-primary)", borderRadius: 2 }}>
        {line.slice(idx, idx + q.length)}
      </mark>,
    );
    i = idx + q.length;
  }
  return parts;
}

const HL = 20;

export function PromptModalBody({ text, highlight = false }: { text: string; highlight?: boolean }) {
  const t = useTranslations("runs");
  const [q, setQ] = React.useState("");
  const lines = React.useMemo(() => (text || "—").split("\n"), [text]);
  const ql = q.trim().toLowerCase();
  const shown = ql ? lines.filter((l) => l.toLowerCase().includes(ql)) : lines;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "70vh" }}>
      <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <TextInput
          value={q}
          onChange={setQ}
          placeholder={t("trace.prompt.search")}
          suffix={
            ql ? (
              <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                {shown.length} / {lines.length}
              </span>
            ) : undefined
          }
        />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {ql && shown.length === 0 ? (
          <div style={{ padding: "32px 24px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
            {t("trace.prompt.noMatches", { q: q.trim() })}
          </div>
        ) : highlight ? (
          <div
            style={{
              display: "flex",
              fontFamily: "monospace",
              fontSize: 12.5,
              lineHeight: `${HL}px`,
            }}
          >
            {!ql && (
              <div
                style={{
                  flexShrink: 0,
                  width: 44,
                  padding: "16px 0",
                  background: "rgba(0,0,0,0.18)",
                  borderRight: "1px solid var(--border)",
                  userSelect: "none",
                }}
              >
                {lines.map((_, i) => (
                  <div
                    key={i}
                    style={{
                      height: HL,
                      lineHeight: `${HL}px`,
                      fontSize: 11,
                      paddingRight: 10,
                      color: "var(--text-muted)",
                      textAlign: "right",
                      opacity: 0.6,
                    }}
                  >
                    {i + 1}
                  </div>
                ))}
              </div>
            )}
            <div style={{ flex: 1, padding: "16px 24px", minWidth: 0 }}>
              {shown.map((line, i) => (
                <div
                  key={i}
                  style={{
                    height: HL,
                    lineHeight: `${HL}px`,
                    color: hlLineColor(line),
                    whiteSpace: "pre",
                  }}
                >
                  {ql ? highlightLine(line, q) : (line || "​")}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <pre
            className="mono"
            style={{ margin: 0, padding: "16px 24px", whiteSpace: "pre-wrap", fontSize: 12.5, lineHeight: 1.6 }}
          >
            {ql ? shown.map((l, i) => <div key={i}>{highlightLine(l, q)}</div>) : text || "—"}
          </pre>
        )}
      </div>
    </div>
  );
}
