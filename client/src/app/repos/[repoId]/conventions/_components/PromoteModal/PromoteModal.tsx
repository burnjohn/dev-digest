"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Modal, Button } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { usePromoteConventions } from "@/lib/hooks/conventions";

interface Props {
  repoId: string;
  repoUrl: string;
  repoName: string;
  accepted: ConventionCandidate[];
  onClose: () => void;
}

function buildSkillBody(repoName: string, accepted: ConventionCandidate[]): string {
  const lines = [
    `# ${repoName}-conventions`,
    ``,
    `House conventions for \`${repoName}\`. Flag changes that violate any rule below and cite the offending \`file:line\`.`,
  ];
  const byCategory = new Map<string, ConventionCandidate[]>();
  for (const c of accepted) {
    const cat = c.category ?? "General";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(c);
  }
  for (const [cat, items] of byCategory) {
    lines.push(``, `## ${cat}`);
    for (const c of items) {
      lines.push(`${c.rule}`);
      if (c.evidence_path) lines.push(`Detected in \`${c.evidence_path}\`:`);
      if (c.evidence_snippet) lines.push(`\`\`\``, c.evidence_snippet, `\`\`\``);
    }
  }
  return lines.join("\n");
}

export function PromoteModal({ repoId, repoUrl, repoName, accepted, onClose }: Props) {
  const router = useRouter();
  const promote = usePromoteConventions(repoId);

  const shortName = repoName.includes("/") ? repoName.split("/")[1] : repoName;
  const [name, setName] = React.useState(`${shortName}-conventions`);
  const [description, setDescription] = React.useState(
    `${accepted.length} house conventions extracted from ${shortName}`,
  );
  const [body, setBody] = React.useState(() => buildSkillBody(shortName ?? repoName, accepted));

  const [enabled, setEnabled] = React.useState(true);

  const handleSave = async () => {
    const result = await promote.mutateAsync({ repoUrl, name, description });
    router.push(`/skills/${result.skill_id}`);
    onClose();
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "var(--bg-surface)",
    border: "1px solid var(--border-strong)",
    borderRadius: 6,
    color: "var(--text-primary)",
    padding: "8px 12px",
    fontSize: 13,
    boxSizing: "border-box",
  };

  return (
    <Modal
      title="Create skill from conventions"
      subtitle={`${shortName}-conventions`}
      onClose={onClose}
      width={680}
      footer={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", flex: 1 }}>
            Saved as v1 · added to Skills Lab
          </span>
          <Button kind="ghost" onClick={onClose}>Cancel</Button>
          <Button kind="primary" icon="Sparkles" loading={promote.isPending} onClick={handleSave}>
            Create skill
          </Button>
        </div>
      }
    >
      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Info banner */}
        <div
          style={{
            background: "rgba(99,102,241,0.08)",
            border: "1px solid rgba(99,102,241,0.2)",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 13,
            color: "var(--text-secondary)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          ✦ Merged from <strong>{accepted.length} accepted conventions</strong> in{" "}
          <span style={{ color: "var(--accent)" }}>{shortName}</span>. Everything below is
          editable before you save.
        </div>

        {/* Name */}
        <div>
          <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
            Name <span style={{ color: "var(--crit)" }}>*</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
          />
        </div>

        {/* Description */}
        <div>
          <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
            Description
          </label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={inputStyle}
          />
        </div>

        {/* Type + Enabled row */}
        <div style={{ display: "flex", gap: 24 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
              Type
            </label>
            <select value="convention" style={inputStyle}>
              <option value="convention">convention</option>
              <option value="custom">custom</option>
              <option value="rubric">rubric</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
              Enabled
            </label>
            <div
              onClick={() => setEnabled((v) => !v)}
              style={{
                width: 38,
                height: 22,
                borderRadius: 11,
                background: enabled ? "var(--accent)" : "var(--bg-hover)",
                marginTop: 4,
                cursor: "pointer",
                transition: "background .15s",
                display: "flex",
                alignItems: "center",
                padding: "0 3px",
              }}
            >
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: "#fff",
                  transform: enabled ? "translateX(16px)" : "translateX(0)",
                  transition: "transform .15s",
                }}
              />
            </div>
          </div>
        </div>

        {/* Skill body */}
        <div>
          <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
            Skill body <span style={{ color: "var(--crit)" }}>*</span>
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            style={{
              ...inputStyle,
              fontFamily: "monospace",
              fontSize: 12,
              resize: "vertical",
              lineHeight: 1.6,
            }}
          />
        </div>
      </div>
    </Modal>
  );
}
