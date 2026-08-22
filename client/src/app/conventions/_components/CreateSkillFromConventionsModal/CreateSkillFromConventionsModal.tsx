"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useCreateSkillFromConventions } from "@/lib/hooks/conventions";

interface Props {
  repoId: string;
  repoName: string;
  acceptedCount: number;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateSkillFromConventionsModal({
  repoId,
  repoName,
  acceptedCount,
  onClose,
  onCreated,
}: Props) {
  const router = useRouter();
  const createSkill = useCreateSkillFromConventions();
  const [name, setName] = React.useState(`${repoName}-conventions`);
  const [description, setDescription] = React.useState(
    `${acceptedCount} house conventions extracted from ${repoName}`,
  );

  const handleCreate = async () => {
    const skill = await createSkill.mutateAsync({ repoId, name, description });
    onCreated();
    router.push(`/skills/${skill.id}`);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 28,
          width: 480,
          maxWidth: "90vw",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
          Create skill from conventions
        </h2>

        {/* Info banner */}
        <div
          style={{
            background: "color-mix(in srgb, var(--accent) 10%, transparent)",
            border:
              "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 13,
            color: "var(--text-secondary)",
          }}
        >
          ✦ Merged from <strong>{acceptedCount} accepted conventions</strong> in{" "}
          <span style={{ color: "var(--accent)" }}>{repoName}</span>. Everything
          below is editable before you save.
        </div>

        {/* Name */}
        <div>
          <label
            style={{
              fontSize: 13,
              fontWeight: 600,
              display: "block",
              marginBottom: 6,
            }}
          >
            Name *
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px",
              border: "1px solid var(--border)",
              borderRadius: 7,
              background: "var(--bg-elevated)",
              color: "var(--text-primary)",
              fontSize: 14,
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Description */}
        <div>
          <label
            style={{
              fontSize: 13,
              fontWeight: 600,
              display: "block",
              marginBottom: 6,
            }}
          >
            Description
          </label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px",
              border: "1px solid var(--border)",
              borderRadius: 7,
              background: "var(--bg-elevated)",
              color: "var(--text-primary)",
              fontSize: 14,
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 8,
          }}
        >
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            ← Saved as v1 · added to Skills Lab
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                padding: "8px 16px",
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text-secondary)",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!name.trim() || createSkill.isPending}
              style={{
                padding: "8px 16px",
                borderRadius: 7,
                border: "none",
                background: "var(--accent)",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor:
                  !name.trim() || createSkill.isPending
                    ? "not-allowed"
                    : "pointer",
                opacity: !name.trim() || createSkill.isPending ? 0.6 : 1,
              }}
            >
              {createSkill.isPending ? "Creating…" : "✦ Create skill"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
