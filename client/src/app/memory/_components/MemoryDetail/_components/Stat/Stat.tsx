"use client";

import React from "react";
import { s } from "../../styles";

/** A single labelled metric in the memory detail panel. */
export function Stat({
  label,
  value,
  color,
  tnum,
}: {
  label: string;
  value: string;
  color?: string;
  tnum?: boolean;
}) {
  return (
    <div>
      <div style={s.statLabel}>{label}</div>
      <div className={tnum ? "tnum" : undefined} style={s.statValue(color)}>
        {value}
      </div>
    </div>
  );
}
