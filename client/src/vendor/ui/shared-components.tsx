/* shared-components.tsx — cross-feature components ported from components2.jsx:
   LiveLogStream, ExportWizardSteps, AutoTriggerStatus. */
import React from "react";
import { Icon } from "./icons";
import { IconBtn } from "./primitives";

export interface LogLine {
  t: string;
  k: "info" | "result" | "tool" | "error";
  m: string;
}

const LOG_COLOR: Record<LogLine["k"], string> = {
  info: "var(--accent-text)",
  result: "var(--ok)",
  tool: "var(--warn)",
  error: "var(--crit)",
};

export function LiveLogStream({
  log,
  running,
  height = 260,
  elapsedLabel,
}: {
  log: LogLine[];
  running?: boolean;
  height?: number;
  elapsedLabel?: string;
}) {
  const [filter, setFilter] = React.useState("");
  const shown = filter.trim()
    ? log.filter((l) => l.m.toLowerCase().includes(filter.toLowerCase()) || l.k.includes(filter.toLowerCase()))
    : log;
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--code-bg)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-surface)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg-elevated)",
            width: 170,
          }}
        >
          <Icon.Search size={12} style={{ color: "var(--text-muted)" }} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter log…"
            style={{
              flex: 1,
              fontSize: 12,
              color: "var(--text-primary)",
              background: "transparent",
              border: "none",
              outline: "none",
            }}
          />
        </div>
        {running ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: "var(--warn)",
              fontWeight: 600,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--warn)", animation: "ddpulse 1s infinite" }} />
            {elapsedLabel ?? "Running"}
          </span>
        ) : (
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{shown.length} lines</span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
          <IconBtn icon="RefreshCw" label="Replay" size={26} />
          <IconBtn icon="Copy" label="Copy log" size={26} />
        </div>
      </div>
      <div style={{ height, overflow: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
        {shown.map((l, i) => (
          <div
            key={i}
            className="mono"
            style={{ fontSize: 12, lineHeight: 1.5, display: "flex", gap: 10, animation: "ddfadein .2s ease" }}
          >
            <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>[{l.t}]</span>
            <span style={{ color: LOG_COLOR[l.k], flexShrink: 0, fontWeight: 600 }}>[{l.k}]</span>
            <span style={{ color: "var(--text-primary)" }}>{l.m}</span>
          </div>
        ))}
        {running && (
          <div className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>
            <span
              style={{
                display: "inline-block",
                width: 7,
                height: 13,
                background: "var(--ok)",
                animation: "ddpulse 1s infinite",
                verticalAlign: "middle",
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function ExportWizardSteps({ step, labels }: { step: number; labels: string[] }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, padding: "0 5px" }}>
      {labels.map((l, i) => (
        <React.Fragment key={i}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: 99,
                display: "grid",
                placeItems: "center",
                fontSize: 12,
                fontWeight: 700,
                flexShrink: 0,
                background: i < step ? "var(--ok)" : i === step ? "var(--accent)" : "var(--bg-elevated)",
                color: i <= step ? "#fff" : "var(--text-muted)",
                border: i > step ? "1px solid var(--border-strong)" : "none",
              }}
            >
              {i < step ? <Icon.Check size={13} /> : i + 1}
            </div>
            <span
              style={{
                fontSize: 13,
                fontWeight: i === step ? 600 : 500,
                color: i <= step ? "var(--text-primary)" : "var(--text-muted)",
                whiteSpace: "nowrap",
              }}
            >
              {l}
            </span>
          </div>
          {i < labels.length - 1 && (
            <div
              style={{
                flex: 1,
                height: 1,
                minWidth: 24,
                background: i < step ? "var(--ok)" : "var(--border-strong)",
                margin: "0 14px",
              }}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

export function AutoTriggerStatus({
  on = true,
  detail,
}: {
  on?: boolean;
  detail?: string;
}) {
  return (
    <button
      title="Settings → Automatic Reviews"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 12px",
        borderRadius: 7,
        border: "1px solid var(--border)",
        background: "var(--bg-surface)",
        fontSize: 13,
        color: "var(--text-secondary)",
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: 99,
          background: on ? "var(--ok)" : "var(--text-muted)",
          boxShadow: on ? "0 0 0 3px var(--ok-bg)" : "none",
          animation: on ? "ddpulse 2s ease-in-out infinite" : "none",
        }}
      />
      <span>
        Auto-review:{" "}
        <b style={{ color: on ? "var(--ok)" : "var(--text-muted)", fontWeight: 600 }}>{on ? "ON" : "OFF"}</b>
      </span>
      {on && <span style={{ color: "var(--text-muted)" }}>· {detail ?? "polling 5m"}</span>}
    </button>
  );
}
