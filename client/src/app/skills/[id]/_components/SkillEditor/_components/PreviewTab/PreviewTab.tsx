"use client";
import React from "react";
import type { Skill } from "@devdigest/shared";
import { Markdown } from "@devdigest/ui";

export function PreviewTab({ skill }: { skill: Skill }) {
  return (
    <div style={{ maxWidth: 720 }}>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
        Rendered as the reviewing agent receives it
      </p>
      <div
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "16px 20px",
        }}
      >
        <Markdown>{skill.body}</Markdown>
      </div>
    </div>
  );
}
