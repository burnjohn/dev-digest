"use client";

import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom";
import { Icon } from "@devdigest/ui";
import { Toggle } from "@devdigest/ui";
import type { Convention, SkillType, ConventionSkillInput } from "@devdigest/shared";

interface Props {
  accepted: Convention[];
  repoName?: string;
  onSave: (input: ConventionSkillInput) => void;
  onClose: () => void;
  loading?: boolean;
}

const SKILL_TYPES: { value: SkillType; label: string }[] = [
  { value: "convention", label: "Convention" },
  { value: "rubric", label: "Rubric" },
  { value: "security", label: "Security" },
  { value: "custom", label: "Custom" },
];

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function SkillDraftModal({ accepted, repoName, onSave, onClose, loading }: Props) {
  const defaultName = slugify(`${repoName ?? "repo"}-conventions`);
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState(
    `${accepted.length} house conventions extracted from ${repoName ?? "this repo"}`,
  );
  const [type, setType] = useState<SkillType>("convention");
  const [enabled, setEnabled] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleCreate = () => {
    if (!name.trim()) return;
    setSaved(true);
    onSave({ mode: "merge", name: name.trim(), description, type });
  };

  const modal = (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          width: 660,
          maxWidth: "94vw",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* ── Modal header ── */}
        <div
          style={{
            padding: "22px 24px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
          }}
        >
          <div>
            <h2
              style={{ margin: 0, fontSize: 17, fontWeight: 600, color: "var(--text-primary)" }}
            >
              Create skill from conventions
            </h2>
            {repoName && (
              <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--text-muted)" }}>
                {name || defaultName}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              padding: 4,
              borderRadius: 4,
              display: "flex",
            }}
          >
            <Icon.X size={16} />
          </button>
        </div>

        {/* ── Body ── */}
        <div style={{ padding: "20px 24px", flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Info banner */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "11px 14px",
              background: "rgba(99,102,241,0.08)",
              border: "1px solid rgba(99,102,241,0.3)",
              borderRadius: 8,
              fontSize: 13,
              color: "var(--text-secondary)",
            }}
          >
            <Icon.Sparkles size={14} style={{ color: "var(--accent)", marginTop: 1, flexShrink: 0 }} />
            <span>
              Merged from{" "}
              <strong style={{ color: "var(--text-primary)" }}>
                {accepted.length} accepted convention{accepted.length !== 1 ? "s" : ""}
              </strong>
              {repoName ? (
                <>
                  {" "}in{" "}
                  <strong style={{ color: "var(--accent)" }}>{repoName}</strong>
                </>
              ) : null}
              . Everything below is editable before you save.
            </span>
          </div>

          {/* Name */}
          <Field label="Name" required>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
              placeholder={defaultName}
              autoFocus
            />
          </Field>

          {/* Description */}
          <Field label="Description">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={inputStyle}
              placeholder="Short description of what this skill checks"
            />
          </Field>

          {/* Type + Enabled row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Field label="Type">
              <div style={{ position: "relative" }}>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as SkillType)}
                  style={{ ...inputStyle, appearance: "none", paddingRight: 28 }}
                >
                  {SKILL_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <Icon.ChevronDown
                  size={14}
                  style={{
                    position: "absolute",
                    right: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--text-muted)",
                    pointerEvents: "none",
                  }}
                />
              </div>
            </Field>

            <Field label="Enabled">
              <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 6 }}>
                <Toggle on={enabled} onChange={setEnabled} />
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Whether this block is added to agents' prompts.
                </span>
              </div>
            </Field>
          </div>

          {/* Skill body preview */}
          <Field label="Skill body" required>
            <SkillBodyPreview accepted={accepted} repoName={repoName} />
          </Field>
        </div>

        {/* ── Footer ── */}
        <div
          style={{
            padding: "14px 24px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 5 }}>
            {saved ? (
              <>
                <Icon.Check size={12} />
                Saved as v1 · added to Skills Lab
              </>
            ) : (
              <>
                <Icon.ChevronLeft size={12} />
                Saved as v1 · added to Skills Lab
              </>
            )}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} disabled={loading} style={cancelBtnStyle}>
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={loading || !name.trim()}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                borderRadius: 7,
                border: "none",
                background: "var(--accent)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                cursor: loading || !name.trim() ? "default" : "pointer",
                opacity: loading || !name.trim() ? 0.55 : 1,
              }}
            >
              <Icon.Sparkles size={13} />
              {loading ? "Creating…" : "Create skill"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return ReactDOM.createPortal(modal, document.body);
}

/* ── Skill body preview (read-only, line-numbered) ── */
function SkillBodyPreview({ accepted, repoName }: { accepted: Convention[]; repoName?: string }) {
  const body = buildPreviewBody(accepted, repoName);
  const lines = body.split("\n");
  const tokenEst = Math.round(body.length / 4);

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        overflow: "hidden",
        background: "var(--bg-base)",
      }}
    >
      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 12px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-elevated)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon.FileText size={12} style={{ color: "var(--text-muted)" }} />
          <span style={{ fontSize: 12, fontFamily: "var(--font-mono, monospace)", color: "var(--text-secondary)" }}>
            {slugify((repoName ?? "repo") + "-conventions")}.md
          </span>
          <span
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              background: "var(--border)",
              borderRadius: 3,
              padding: "1px 5px",
            }}
          >
            unsaved
          </span>
        </div>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{tokenEst} tokens</span>
      </div>

      {/* Line-numbered code */}
      <div style={{ maxHeight: 260, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "var(--font-mono, monospace)" }}>
          <tbody>
            {lines.map((line, i) => (
              <tr key={i}>
                <td
                  style={{
                    padding: "0 12px 0 14px",
                    color: "var(--text-muted)",
                    userSelect: "none",
                    textAlign: "right",
                    width: 32,
                    lineHeight: "22px",
                    verticalAlign: "top",
                  }}
                >
                  {i + 1}
                </td>
                <td
                  style={{
                    padding: "0 16px 0 4px",
                    lineHeight: "22px",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    color: line.startsWith("# ")
                      ? "var(--accent)"
                      : line.startsWith("## ")
                      ? "#7eb6ff"
                      : line.startsWith("```")
                      ? "var(--text-muted)"
                      : "var(--text-secondary)",
                  }}
                >
                  {line || " "}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function buildPreviewBody(accepted: Convention[], repoName?: string): string {
  const repoSlug = slugify(repoName ?? "repo");
  const lines: string[] = [
    `# ${repoSlug}-conventions`,
    "",
    `Enforce house conventions for \`${repoName ?? "this repo"}\`.`,
    "When reviewing a diff, flag every line that violates a rule below.",
    "For each violation: cite `file:line`, quote the offending code, state which rule it breaks,",
    "and show what the correct version should look like.",
    "Set severity to **WARNING** for style/convention violations,",
    "**CRITICAL** if the violation could cause a runtime error or data loss.",
    "",
  ];
  for (const c of accepted) {
    const rule = c.edited_rule ?? c.rule;
    const cat = c.category ?? "General";
    lines.push(`## ${slugify(cat)}`);
    lines.push("");
    lines.push(`**Rule:** ${rule}`);
    lines.push("");
    if (c.evidence_snippet) {
      lines.push("✅ Correct pattern (as used in this codebase):");
      lines.push("```");
      lines.push(c.evidence_snippet);
      lines.push("```");
      lines.push("");
    }
    lines.push("❌ Violation: any deviation from the rule above — wrong type, missing decorator,");
    lines.push("   wrong import style, or omitted convention — must be flagged as a finding.");
    lines.push("");
  }
  return lines.join("\n");
}

/* ── Primitives ── */
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)" }}>
        {label}
        {required && <span style={{ color: "var(--danger, #ef4444)", marginLeft: 3 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--bg-base)",
  border: "1px solid var(--border-strong)",
  borderRadius: 7,
  color: "var(--text-primary)",
  fontSize: 13,
  padding: "9px 12px",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const cancelBtnStyle: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 7,
  border: "1px solid var(--border-strong)",
  background: "transparent",
  color: "var(--text-secondary)",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};
