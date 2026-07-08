"use client";

import React from "react";
import { Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";

interface PreviewTabProps {
  skill: Skill;
}

export function PreviewTab({ skill }: PreviewTabProps) {
  return (
    <div style={{ padding: "24px 28px", maxWidth: 760 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Preview</h2>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>
        Rendered as the reviewing agent receives it.
      </p>
      <div
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "24px 28px",
          fontSize: 14,
          lineHeight: 1.6,
        }}
      >
        <Markdown>{skill.body}</Markdown>
      </div>
    </div>
  );
}
