"use client";

import React from "react";
import { Icon } from "@devdigest/ui";
import { s } from "../../styles";

/** A single checkbox filter row (scope / kind / freshness). */
export function CheckRow({
  label,
  count,
  on,
  onClick,
}: {
  label: string;
  count?: number;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} style={s.checkRow}>
      <span style={s.checkBox(on)}>{on && <Icon.Check size={11} style={s.checkIcon} />}</span>
      <span style={s.checkLabel}>{label}</span>
      {count != null && (
        <span className="tnum" style={s.checkCount}>
          {count}
        </span>
      )}
    </button>
  );
}
