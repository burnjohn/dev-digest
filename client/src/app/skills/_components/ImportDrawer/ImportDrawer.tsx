/* ImportDrawer — modal for importing a skill from a .md or .zip file.
   Reads the file as base64, calls the preview mutation, then creates the skill. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button, FormField } from "@devdigest/ui";
import { useImportSkillPreview, useCreateSkill } from "../../../../lib/hooks/skills";

export function ImportDrawer({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const importPreview = useImportSkillPreview();
  const createSkill = useCreateSkill();
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<null | {
    name: string;
    description: string;
    type: string;
    source: string;
    body: string;
    ignored_files: string[];
  }>(null);
  const [error, setError] = React.useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setError(null);
    setPreview(null);

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      const base64 = dataUrl.split(",")[1]!;
      importPreview.mutate(
        { filename: f.name, content_base64: base64 },
        {
          onSuccess: (result) => setPreview(result),
          onError: (err) => setError(err.message),
        }
      );
    };
    reader.readAsDataURL(f);
  };

  const handleConfirm = () => {
    if (!preview) return;
    createSkill.mutate(
      {
        name: preview.name,
        description: preview.description,
        type: preview.type as "rubric" | "convention" | "security" | "custom",
        source: "imported_url",
        body: preview.body,
        enabled: false,
      },
      {
        onSuccess: (skill) => {
          onClose();
          router.push(`/skills/${skill.id}?tab=config`);
        },
        onError: (err) => setError(err.message),
      }
    );
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 9999,
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
          width: 520,
          maxHeight: "80vh",
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, flex: 1 }}>Import skill from file</h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              fontSize: 18,
            }}
          >
            ✕
          </button>
        </div>

        <FormField label="File (.md or .zip)">
          <input
            type="file"
            accept=".md,.zip"
            onChange={handleFileChange}
            style={{ fontSize: 13, color: "var(--text-primary)" }}
          />
        </FormField>

        {importPreview.isPending && (
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Reading file…</p>
        )}
        {error && <p style={{ color: "var(--error-text)", fontSize: 13 }}>{error}</p>}

        {preview && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                Extracted name
              </div>
              <div style={{ fontWeight: 600 }}>{preview.name}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Type</div>
              <div>{preview.type}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                Body preview (first 300 chars)
              </div>
              <pre
                style={{
                  fontSize: 12,
                  background: "var(--bg-hover)",
                  borderRadius: 6,
                  padding: "8px 12px",
                  overflow: "auto",
                  maxHeight: 120,
                  color: "var(--text-secondary)",
                }}
              >
                {preview.body.slice(0, 300)}
                {preview.body.length > 300 ? "…" : ""}
              </pre>
            </div>
            {preview.ignored_files.length > 0 && (
              <div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                  Ignored files (not executed)
                </div>
                <ul style={{ fontSize: 12, color: "var(--text-secondary)", paddingLeft: 16 }}>
                  {preview.ignored_files.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
            <p style={{ fontSize: 12, color: "var(--warning-text)" }}>
              ⚠ This skill will be imported as <strong>disabled</strong>. Vet its content before
              enabling it.
            </p>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <Button kind="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            kind="primary"
            size="sm"
            onClick={handleConfirm}
            disabled={!preview || createSkill.isPending}
          >
            {createSkill.isPending ? "Importing…" : "Confirm import"}
          </Button>
        </div>
      </div>
    </div>
  );
}
