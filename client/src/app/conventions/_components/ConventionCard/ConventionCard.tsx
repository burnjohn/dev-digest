"use client";

import React from "react";
import type { ConventionCandidate } from "@devdigest/shared";
import {
  useAcceptConvention,
  useRejectConvention,
  useUpdateConventionRule,
} from "@/lib/hooks/conventions";

interface Props {
  convention: ConventionCandidate;
  repoId: string;
  repoUrl?: string;
}

function confidenceColor(v: number): string {
  if (v >= 0.85) return "var(--success)";
  if (v >= 0.7) return "#f59e0b";
  return "var(--text-muted)";
}

export function ConventionCard({ convention: c, repoId, repoUrl }: Props) {
  const accept = useAcceptConvention();
  const reject = useRejectConvention();
  const updateRule = useUpdateConventionRule();

  const [editing, setEditing] = React.useState(false);
  const [draftRule, setDraftRule] = React.useState(c.rule);

  const handleSaveRule = () => {
    if (draftRule.trim() && draftRule !== c.rule) {
      updateRule.mutate({ repoId, id: c.id, rule: draftRule.trim() });
    }
    setEditing(false);
  };

  const handleCancelEdit = () => {
    setDraftRule(c.rule);
    setEditing(false);
  };

  const evidenceUrl =
    repoUrl && c.evidence_path
      ? `${repoUrl}/blob/main/${c.evidence_path}`
      : undefined;

  return (
    <div
      style={{
        border: `1.5px solid ${c.accepted ? "var(--success)" : "var(--border)"}`,
        borderRadius: 10,
        padding: 16,
        background: "var(--bg-surface)",
        display: "flex",
        gap: 16,
      }}
    >
      {/* Left: rule + evidence */}
      <div style={{ flex: 1 }}>
        {editing ? (
          <div style={{ marginBottom: 10 }}>
            <textarea
              value={draftRule}
              onChange={(e) => setDraftRule(e.target.value)}
              rows={2}
              style={{
                width: "100%",
                padding: "6px 10px",
                border: "1px solid var(--accent)",
                borderRadius: 6,
                background: "var(--bg-elevated)",
                color: "var(--text-primary)",
                fontSize: 14,
                fontStyle: "italic",
                fontWeight: 600,
                resize: "vertical",
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button
                onClick={handleSaveRule}
                disabled={updateRule.isPending}
                style={{
                  padding: "4px 10px",
                  borderRadius: 5,
                  border: "none",
                  background: "var(--accent)",
                  color: "#fff",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Save
              </button>
              <button
                onClick={handleCancelEdit}
                style={{
                  padding: "4px 10px",
                  borderRadius: 5,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--text-muted)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p
            onClick={() => setEditing(true)}
            title="Click to edit"
            style={{
              fontStyle: "italic",
              fontWeight: 600,
              marginBottom: 10,
              fontSize: 14,
              cursor: "text",
            }}
          >
            {c.rule}
          </p>
        )}

        {/* Evidence snippet */}
        {c.evidence_path && (
          <div
            style={{
              background: "var(--bg-elevated)",
              borderRadius: 7,
              padding: "8px 12px",
              fontFamily: "monospace",
              fontSize: 12,
              marginBottom: 10,
            }}
          >
            <div
              style={{
                color: "var(--text-muted)",
                marginBottom: 6,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span>{c.evidence_path}</span>
              {evidenceUrl && (
                <a
                  href={evidenceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent)", fontSize: 11 }}
                >
                  ↗ GitHub
                </a>
              )}
            </div>
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                color: "var(--text-primary)",
              }}
            >
              {c.evidence_snippet}
            </pre>
          </div>
        )}

        {/* Confidence bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          <span>Confidence</span>
          <div
            style={{
              width: 120,
              height: 4,
              background: "var(--border)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.round(c.confidence * 100)}%`,
                height: "100%",
                background: confidenceColor(c.confidence),
                borderRadius: 2,
              }}
            />
          </div>
          <span>{Math.round(c.confidence * 100)}%</span>
        </div>
      </div>

      {/* Right: actions */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          flexShrink: 0,
          minWidth: 110,
        }}
      >
        <button
          onClick={() => !c.accepted && accept.mutate({ repoId, id: c.id })}
          disabled={c.accepted || accept.isPending}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "none",
            background: c.accepted ? "var(--success)" : "var(--accent)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: c.accepted ? "default" : "pointer",
            opacity: accept.isPending ? 0.7 : 1,
          }}
        >
          {c.accepted ? "✓ Accepted" : "✓ Accept"}
        </button>
        <button
          onClick={() => reject.mutate({ repoId, id: c.id })}
          disabled={reject.isPending}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text-muted)",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          × Reject
        </button>
      </div>
    </div>
  );
}
