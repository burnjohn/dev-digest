"use client";

import React, { useRef, useState } from "react";
import { Drawer, Button, Badge, Markdown, Icon } from "@devdigest/ui";
import type { Skill, ImportPreview } from "@devdigest/shared";
import { useImportPreview, useConfirmImport } from "../../../lib/hooks/skills";

interface ImportDrawerProps {
  open: boolean;
  onClose: () => void;
  onImported: (skill: Skill) => void;
}

export function ImportDrawer({ open, onClose, onImported }: ImportDrawerProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [filename, setFilename] = useState("");
  const [error, setError] = useState<string | null>(null);

  const importPreview = useImportPreview();
  const confirmImport = useConfirmImport();

  if (!open) return null;

  const handleFile = (file: File) => {
    setError(null);
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const arrayBuffer = e.target?.result as ArrayBuffer;
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i] ?? 0);
      }
      const b64 = btoa(binary);
      importPreview.mutate(
        { name: "", filename: file.name, content_base64: b64 },
        {
          onSuccess: (p) => setPreview(p),
          onError: (err) => setError(err.message),
        },
      );
    };
    reader.readAsArrayBuffer(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleConfirm = () => {
    if (!preview) return;
    confirmImport.mutate(
      {
        name: preview.name,
        description: "",
        type: preview.type,
        body: preview.body,
        source: "imported_file",
        enabled: false,
      },
      {
        onSuccess: (skill) => {
          setPreview(null);
          setFilename("");
          onImported(skill);
        },
        onError: (err) => setError(err.message),
      },
    );
  };

  const handleClose = () => {
    setPreview(null);
    setFilename("");
    setError(null);
    onClose();
  };

  return (
    <Drawer
      width={620}
      title="Import a skill"
      subtitle="Upload a Markdown file (.md). The skill is saved disabled until you vet and enable it."
      onClose={handleClose}
      footer={
        preview ? (
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              ~{preview.token_estimate} tokens &middot; imported disabled
            </span>
            <Button kind="secondary" size="sm" onClick={() => { setPreview(null); setFilename(""); }}>
              Back
            </Button>
            <Button kind="primary" size="sm" onClick={handleConfirm} disabled={confirmImport.isPending}>
              {confirmImport.isPending ? "Saving..." : "Save skill"}
            </Button>
          </div>
        ) : null
      }
    >
      {!preview ? (
        <div>
          {/* Trust warning */}
          <div
            style={{
              background: "rgba(245, 158, 11, 0.1)",
              border: "1px solid rgba(245, 158, 11, 0.3)",
              borderRadius: 8,
              padding: "12px 16px",
              marginBottom: 20,
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
            }}
          >
            <Icon.AlertTriangle size={16} style={{ color: "var(--warn)", marginTop: 1, flexShrink: 0 }} />
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              An imported skill is external instructions that will be injected verbatim into an agent&apos;s prompt.
              The skill will be saved as <strong>disabled</strong> until you review and enable it.
            </div>
          </div>

          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            style={{
              border: "2px dashed var(--border-strong)",
              borderRadius: 10,
              padding: "36px 24px",
              textAlign: "center",
              cursor: "pointer",
              color: "var(--text-muted)",
              transition: "border-color 120ms",
            }}
          >
            <Icon.Upload size={32} style={{ marginBottom: 12, opacity: 0.5 }} />
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Drop a .md file here</div>
            <div style={{ fontSize: 12 }}>or click to browse &middot; max 512 KB</div>
            <input
              ref={fileRef}
              type="file"
              accept=".md,.txt"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = "";
              }}
            />
          </div>

          {importPreview.isPending && (
            <div style={{ marginTop: 16, fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
              Parsing file...
            </div>
          )}

          {error && (
            <div style={{ marginTop: 16, color: "var(--crit)", fontSize: 13, padding: "10px 14px", background: "rgba(239,68,68,0.08)", borderRadius: 6 }}>
              {error}
            </div>
          )}
        </div>
      ) : (
        <div>
          {/* Preview header */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700 }}>{preview.name}</h2>
            <Badge color="var(--text-muted)">{preview.type}</Badge>
            <Badge color="var(--warn)">
              <Icon.AlertTriangle size={10} style={{ marginRight: 4 }} />
              untrusted source
            </Badge>
          </div>

          <div
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              marginBottom: 16,
              display: "flex",
              gap: 16,
            }}
          >
            <span>
              <Icon.File size={12} style={{ marginRight: 4, verticalAlign: "text-bottom" }} />
              {preview.source_file}
            </span>
            <span>~{preview.token_estimate} tokens</span>
            {preview.ignored_files.length > 0 && (
              <span>{preview.ignored_files.length} file(s) ignored</span>
            )}
          </div>

          {/* Rendered preview */}
          <div
            style={{
              background: "var(--bg-primary)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "20px 24px",
              maxHeight: "50vh",
              overflow: "auto",
            }}
          >
            <Markdown>{preview.body}</Markdown>
          </div>
        </div>
      )}
    </Drawer>
  );
}
