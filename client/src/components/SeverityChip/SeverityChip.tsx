import React from "react";
import { Icon, SEV } from "@devdigest/ui";
import type { Severity } from "@devdigest/shared";

const TOTAL_SLOTS = 12;
const SLOT_W = 1; // dot size px
const GAP = 1;   // gap between slots px

/** Always 12 slots: first `count` slots merge into a solid segment,
 *  remaining (12 - count) render as faded separate dots. */
function SeverityDots({ count, color }: { count: number; color: string }) {
  const filled = Math.min(count, TOTAL_SLOTS);
  const empty = TOTAL_SLOTS - filled;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: GAP }}>
      {filled > 0 && (
        <div
          style={{
            height: 1,
            borderRadius: 0.5,
            background: color,
            width: filled * SLOT_W + Math.max(0, filled - 1) * GAP,
            flexShrink: 0,
          }}
        />
      )}
      {Array.from({ length: empty }).map((_, i) => (
        <div
          key={i}
          style={{
            width: SLOT_W,
            height: SLOT_W,
            borderRadius: 0,
            background: color,
            opacity: 0.2,
            flexShrink: 0,
          }}
        />
      ))}
    </div>
  );
}

export function SeverityChip({ sev, count }: { sev: Severity; count: number }) {
  if (count <= 0) return null;

  const meta = SEV[sev];
  const SIcon = Icon[meta.icon];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: 4,
        minWidth: 28,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 3,
          fontSize: 11.5,
          fontWeight: 600,
          color: meta.c,
        }}
      >
        <SIcon size={12} style={{ flexShrink: 0 }} />
        <span className="tnum">{count}</span>
      </span>
      <SeverityDots count={count} color={meta.c} />
    </div>
  );
}
