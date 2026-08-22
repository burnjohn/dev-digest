"use client";

import React from "react";
import { Button } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";

interface Props {
  candidate: ConventionCandidate;
  repoUrl: string;
  onAccept: () => void;
  onReject: () => void;
  onEdit: (rule: string) => void;
}

export function ConventionCard({ candidate, repoUrl, onAccept, onReject, onEdit }: Props) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(candidate.rule);
  const pct = Math.round(candidate.confidence * 100);
  const evidenceUrl = `${repoUrl}/blob/main/${candidate.evidence_path}`;

  const confColor =
    pct >= 85 ? "var(--ok)" : pct >= 60 ? "var(--warning, #f59e0b)" : "var(--crit)";

  return (
    <div
      style={{
        border: `1px solid ${candidate.accepted ? "var(--ok)" : "var(--border-strong)"}`,
        borderRadius: 10,
        padding: "16px 20px",
        background: candidate.accepted
          ? "rgba(74,222,128,0.04)"
          : "var(--bg-elevated)",
        display: "flex",
        gap: 16,
      }}
    >
      {/* Left: content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Rule */}
        {editing ? (
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{
              width: "100%",
              background: "var(--bg-surface)",
              border: "1px solid var(--border-strong)",
              borderRadius: 6,
              color: "var(--text-primary)",
              padding: "6px 10px",
              fontSize: 13,
              resize: "vertical",
              minHeight: 56,
              marginBottom: 10,
            }}
          />
        ) : (
          <div
            style={{
              fontSize: 14,
              fontStyle: "italic",
              color: "var(--text-primary)",
              fontWeight: 500,
              marginBottom: 10,
              lineHeight: 1.5,
            }}
          >
            {candidate.rule}
          </div>
        )}

        {/* Evidence path */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
            background: "var(--bg-surface)",
            borderRadius: 6,
            padding: "5px 10px",
          }}
        >
          <a
            href={evidenceUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 12, color: "var(--text-secondary)", textDecoration: "none", fontFamily: "monospace", flex: 1 }}
          >
            {candidate.evidence_path}
          </a>
        </div>

        {/* Code snippet */}
        {candidate.evidence_snippet && (
          <pre
            style={{
              margin: "0 0 12px",
              padding: "10px 14px",
              background: "var(--bg-surface)",
              borderRadius: 6,
              fontSize: 12,
              overflowX: "auto",
              color: "var(--text-secondary)",
              lineHeight: 1.6,
              border: "1px solid var(--border)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {candidate.evidence_snippet}
          </pre>
        )}

        {/* Confidence bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)", minWidth: 72 }}>Confidence</span>
          <div
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              background: "var(--bg-hover)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${pct}%`,
                background: confColor,
                borderRadius: 2,
                transition: "width .3s",
              }}
            />
          </div>
          <span style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 34, textAlign: "right" }}>
            {pct}%
          </span>
        </div>
      </div>

      {/* Right: actions */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 100, alignItems: "flex-end" }}>
        {editing ? (
          <>
            <Button
              size="sm"
              kind="primary"
              onClick={() => { onEdit(draft); setEditing(false); }}
            >
              Save
            </Button>
            <Button
              size="sm"
              kind="ghost"
              onClick={() => { setDraft(candidate.rule); setEditing(false); }}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              kind={candidate.accepted ? "primary" : "secondary"}
              icon="Check"
              onClick={onAccept}
              style={{ width: 100 }}
            >
              {candidate.accepted ? "Accepted" : "Accept"}
            </Button>
            <Button
              size="sm"
              kind="ghost"
              icon="X"
              onClick={onReject}
              style={{ width: 100 }}
            >
              Reject
            </Button>
            <Button
              size="sm"
              kind="ghost"
              icon="Edit"
              onClick={() => setEditing(true)}
              style={{ width: 100 }}
            >
              Edit
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
