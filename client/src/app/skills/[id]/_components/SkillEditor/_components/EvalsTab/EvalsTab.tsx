"use client";

import React from "react";
import type { Skill } from "../../../../../../../lib/hooks/skills";

/** EvalsTab — placeholder for skill evals (coming soon). */
export function EvalsTab({ skill: _skill }: { skill: Skill }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "60px 28px",
        fontSize: 14,
        color: "var(--text-muted)",
      }}
    >
      Evals coming soon.
    </div>
  );
}
