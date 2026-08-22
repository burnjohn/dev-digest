/* PreviewTab — renders skill.body as markdown (read-only). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { Skill } from "@devdigest/shared";

export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");

  return (
    <div style={{ padding: 28, maxWidth: 720 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
          Preview
        </h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          Rendered as the reviewing agent receives it.
        </p>
        {skill.source !== "manual" && (
          <span
            style={{
              display: "inline-block",
              marginTop: 8,
              fontSize: 11,
              background: "var(--warn-bg)",
              color: "var(--warn)",
              padding: "2px 8px",
              borderRadius: 4,
              fontWeight: 600,
            }}
          >
            {t("preview.untrustedBadge")}
          </span>
        )}
      </div>
      <pre
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 20,
          fontFamily: "monospace",
          fontSize: 13,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          color: "var(--text-primary)",
          margin: 0,
        }}
      >
        {skill.body}
      </pre>
    </div>
  );
}
