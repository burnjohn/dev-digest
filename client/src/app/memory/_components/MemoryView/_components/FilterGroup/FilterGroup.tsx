"use client";

import React from "react";
import { s } from "../../styles";

/** A labelled group of filter rows in the memory left rail. */
export function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={s.group}>
      <div style={s.groupLabel}>{label}</div>
      <div style={s.groupBody}>{children}</div>
    </div>
  );
}
