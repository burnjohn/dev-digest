"use client";

import React, { useState } from "react";
import { Icon } from "@devdigest/ui";
import type { Convention } from "@devdigest/shared";

interface Props {
  convention: Convention;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onUndo:   (id: string) => void;
  onEdit:   (id: string, rule: string) => void;
  loading?: boolean;
}

export function ConventionCard({ convention: c, onAccept, onReject, onUndo, onEdit, loading }: Props) {
  const [editMode, setEditMode] = useState(false);
  const [draftRule, setDraftRule] = useState(c.edited_rule ?? c.rule);

  const isAccepted = c.status === "accepted" || c.status === "edited";
  const isRejected = c.status === "rejected_user" || c.status === "rejected_evidence";
  const displayRule = c.edited_rule ?? c.rule;
  const confidence = Math.round((c.verified_confidence ?? c.confidence ?? 0) * 100);

  const handleSaveEdit = () => {
    const trimmed = draftRule.trim();
    if (trimmed && trimmed !== displayRule) onEdit(c.id, trimmed);
    setEditMode(false);
  };

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--bg-elevated)",
        overflow: "hidden",
        opacity: isRejected ? 0.45 : 1,
        transition: "opacity .15s",
      }}
    >
      {/* ── Main row ── */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 20, padding: "20px 20px 16px" }}>
        {/* Rule text */}
        <div style={{ flex: 1 }}>
          {editMode ? (
            <textarea
              value={draftRule}
              onChange={(e) => setDraftRule(e.target.value)}
              autoFocus
              style={{
                width: "100%",
                minHeight: 72,
                background: "var(--bg-base)",
                border: "1px solid var(--accent)",
                borderRadius: 6,
                color: "var(--text-primary)",
                fontSize: 15,
                fontStyle: "italic",
                fontWeight: 600,
                padding: "8px 10px",
                resize: "vertical",
                boxSizing: "border-box",
                lineHeight: 1.5,
              }}
            />
          ) : (
            <p style={{ fontStyle: "italic", fontWeight: 600, fontSize: 15, color: "var(--text-primary)", margin: 0, lineHeight: 1.55 }}>
              {displayRule}
            </p>
          )}
        </div>

        {/* Action column (fixed width) */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 5, flexShrink: 0, width: 108 }}>
          {editMode ? (
            <>
              <Btn color="accent" onClick={handleSaveEdit} disabled={loading}>
                <Icon.Check size={13} /> Save
              </Btn>
              <Btn color="ghost" onClick={() => setEditMode(false)}>
                Cancel
              </Btn>
            </>
          ) : isAccepted ? (
            <>
              {/* Green "Accepted" badge */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                padding: "7px 10px", borderRadius: 6,
                background: "rgba(34,197,94,0.15)",
                color: "var(--success)", fontSize: 13, fontWeight: 600,
              }}>
                <Icon.Check size={13} /> Accepted
              </div>
              {/* Undo + Edit row */}
              <div style={{ display: "flex", justifyContent: "center", gap: 2 }}>
                <InlineBtn color="muted" disabled={loading} onClick={() => onUndo(c.id)} title="Undo — reset to pending">
                  <Icon.RefreshCw size={11} /> Undo
                </InlineBtn>
                <InlineBtn color="danger" disabled={loading} onClick={() => onReject(c.id)} title="Reject">
                  <Icon.X size={11} /> Reject
                </InlineBtn>
                <InlineBtn color="muted" disabled={loading} onClick={() => setEditMode(true)} title="Edit rule">
                  <Icon.Edit size={11} />
                </InlineBtn>
              </div>
            </>
          ) : isRejected ? (
            <>
              {/* Red "Rejected" badge */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                padding: "7px 10px", borderRadius: 6,
                background: "rgba(239,68,68,0.12)",
                color: "var(--crit)", fontSize: 13, fontWeight: 600,
              }}>
                <Icon.X size={13} /> Rejected
              </div>
              {/* Undo — go back to pending */}
              <Btn color="accent" disabled={loading} onClick={() => onUndo(c.id)}>
                <Icon.RefreshCw size={12} /> Undo
              </Btn>
            </>
          ) : (
            <>
              {/* Accept — blue primary */}
              <Btn color="accent" disabled={loading} onClick={() => onAccept(c.id)}>
                <Icon.Check size={13} /> Accept
              </Btn>
              {/* Reject + Edit */}
              <div style={{ display: "flex", justifyContent: "center", gap: 2 }}>
                <InlineBtn color="danger" disabled={loading} onClick={() => onReject(c.id)}>
                  <Icon.X size={11} /> Reject
                </InlineBtn>
                <InlineBtn color="muted" disabled={loading} onClick={() => setEditMode(true)} title="Edit rule">
                  <Icon.Edit size={11} />
                </InlineBtn>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Evidence ── */}
      {c.evidence_path && (
        <div style={{ padding: "0 20px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, fontSize: 12, fontFamily: "var(--font-mono, monospace)" }}>
            <span style={{ color: "var(--text-muted)" }}>
              {c.evidence_path}
              {c.evidence_line != null ? `:${c.evidence_line}` : ""}
              {c.evidence_line_end != null && c.evidence_line_end !== c.evidence_line ? `-${c.evidence_line_end}` : ""}
            </span>
            {c.evidence_url && (
              <>
                <span style={{ color: "var(--border-strong)", userSelect: "none", fontSize: 10 }}>›</span>
                <a
                  href={c.evidence_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--accent)", textDecoration: "none", display: "flex", alignItems: "center", gap: 3, fontFamily: "inherit", fontSize: 12 }}
                >
                  GitHub <Icon.ExternalLink size={10} />
                </a>
              </>
            )}
          </div>
          {c.evidence_snippet && (
            <pre style={{
              margin: 0, padding: "12px 16px",
              background: "var(--bg-base)", border: "1px solid var(--border)",
              borderRadius: 6, fontSize: 12,
              fontFamily: "var(--font-mono, monospace)",
              color: "var(--text-secondary)",
              whiteSpace: "pre-wrap", wordBreak: "break-word",
              lineHeight: 1.65, overflowX: "auto",
            }}>
              {c.evidence_snippet}
            </pre>
          )}
        </div>
      )}

      {/* ── Confidence bar ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 20px 14px",
        borderTop: "1px solid var(--border)",
      }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>Confidence</span>
        <div style={{ flex: 1, height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${confidence}%`,
            background: confidence >= 70 ? "var(--success)" : "var(--warning)",
            borderRadius: 2, transition: "width .4s ease",
          }} />
        </div>
        <span style={{ fontSize: 11, color: "var(--text-muted)", minWidth: 36, textAlign: "right" }}>
          {confidence}%
        </span>
      </div>
    </div>
  );
}

/* ── Colored full-width button ── */
const BTN_COLORS = {
  accent: { bg: "var(--accent)",       color: "#fff",                border: "transparent" },
  success:{ bg: "rgba(34,197,94,.15)", color: "var(--success)",      border: "transparent" },
  danger: { bg: "rgba(239,68,68,.12)", color: "var(--crit)",         border: "transparent" },
  ghost:  { bg: "transparent",         color: "var(--text-secondary)",border: "var(--border-strong)" },
  muted:  { bg: "transparent",         color: "var(--text-muted)",   border: "transparent" },
} as const;

function Btn({
  children, color, onClick, disabled, title,
}: {
  children: React.ReactNode;
  color: keyof typeof BTN_COLORS;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const s = BTN_COLORS[color];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
        width: "100%", padding: "7px 10px", borderRadius: 6,
        background: s.bg, color: s.color,
        border: s.border === "transparent" ? "none" : `1px solid ${s.border}`,
        fontSize: 13, fontWeight: 600,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "opacity .1s",
      }}
    >
      {children}
    </button>
  );
}

/* ── Small inline text action ── */
function InlineBtn({
  children, color, onClick, disabled, title,
}: {
  children: React.ReactNode;
  color: "danger" | "muted" | "accent";
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const c = color === "danger" ? "var(--crit)" : color === "accent" ? "var(--accent)" : "var(--text-muted)";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: "flex", alignItems: "center", gap: 3,
        padding: "3px 6px", background: "none", border: "none",
        cursor: disabled ? "default" : "pointer",
        fontSize: 11, color: c, borderRadius: 4,
        opacity: disabled ? 0.4 : 1,
        transition: "opacity .1s",
      }}
    >
      {children}
    </button>
  );
}
