import React from "react";
import { Icon } from "@devdigest/ui";
import type { ConformanceItem } from "@devdigest/shared";
import { ConfCard } from "../ConfCard";
import { s } from "./styles";

/** One of the three conformance columns (Implemented / Missing / Scope creep). */
export function Column({
  icon,
  label,
  color,
  items,
  noneLabel,
}: {
  icon: "CheckCircle" | "AlertTriangle" | "Plus";
  label: string;
  color: string;
  items: ConformanceItem[];
  noneLabel: string;
}) {
  return (
    <div style={s.col}>
      <div style={s.head(color)}>
        {React.createElement(Icon[icon], { size: 15, style: s.headIcon(color) })}
        <span style={s.headLabel(color)}>{label}</span>
        <span className="tnum" style={s.count(color)}>
          {items.length}
        </span>
      </div>
      {items.map((it, i) => (
        <ConfCard key={i} title={it.requirement} note={it.notes} ev={it.evidence_file} color={color} />
      ))}
      {items.length === 0 && <div style={s.none}>{noneLabel}</div>}
    </div>
  );
}

export default Column;
