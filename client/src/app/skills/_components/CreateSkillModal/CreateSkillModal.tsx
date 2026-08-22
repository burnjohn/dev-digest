/* CreateSkillModal — two tabs: Create (manual) | Import (from .md or .zip file). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, TextInput, SelectInput } from "@devdigest/ui";
import { useCreateSkill, useImportSkill } from "@/lib/hooks/skills";
import { useImportSkillFromUrl } from "@/lib/hooks/conventions";

const MODAL_OVERLAY: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  zIndex: 100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const MODAL_BOX: React.CSSProperties = {
  background: "var(--bg-surface)",
  borderRadius: 12,
  padding: 28,
  width: 480,
  maxWidth: "90vw",
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

/** Native ZIP parser — no third-party deps. Extracts all .md entries.
 *  Supports stored (method 0) and deflated (method 8) entries via DecompressionStream. */
async function extractMdFromZip(
  buffer: ArrayBuffer,
): Promise<{ name: string; body: string }[]> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const results: { name: string; body: string }[] = [];
  let offset = 0;

  while (offset < bytes.length - 30) {
    // Local file header signature: PK\x03\x04 = 0x04034b50
    if (view.getUint32(offset, true) !== 0x04034b50) {
      offset++;
      continue;
    }

    const compression = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const filenameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const filename = new TextDecoder().decode(
      bytes.slice(offset + 30, offset + 30 + filenameLen),
    );
    const dataStart = offset + 30 + filenameLen + extraLen;
    const compressedData = bytes.slice(dataStart, dataStart + compressedSize);

    if (filename.endsWith(".md") && compressedSize > 0) {
      try {
        let text: string;
        if (compression === 0) {
          text = new TextDecoder().decode(compressedData);
        } else if (compression === 8) {
          const ds = new DecompressionStream("deflate-raw");
          const writer = ds.writable.getWriter();
          writer.write(compressedData);
          writer.close();
          const chunks: Uint8Array[] = [];
          const reader = ds.readable.getReader();
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) chunks.push(value);
          }
          const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
          let pos = 0;
          for (const c of chunks) {
            out.set(c, pos);
            pos += c.length;
          }
          text = new TextDecoder().decode(out);
        } else {
          offset = dataStart + compressedSize;
          continue;
        }
        results.push({ name: filename, body: text });
      } catch {
        /* skip unreadable entry */
      }
    }

    offset = dataStart + compressedSize;
  }

  return results;
}

const TYPE_OPTIONS = [
  { value: "rubric", label: "Rubric" },
  { value: "convention", label: "Convention" },
  { value: "security", label: "Security" },
  { value: "custom", label: "Custom" },
];

export function CreateSkillModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const t = useTranslations("skills");
  const [tab, setTab] = React.useState<"create" | "import" | "url">("create");

  // Create form
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState("rubric");
  const [body, setBody] = React.useState("");
  const create = useCreateSkill();

  // Import form
  const [importName, setImportName] = React.useState("");
  const [importBody, setImportBody] = React.useState("");
  const [importType, setImportType] = React.useState("rubric");
  const [zipEntries, setZipEntries] = React.useState<
    { name: string; body: string }[]
  >([]);
  const [zipPick, setZipPick] = React.useState<string | null>(null);
  const importSkill = useImportSkill();

  // URL import form
  const [importUrl, setImportUrl] = React.useState("");
  const [urlName, setUrlName] = React.useState("");
  const importFromUrl = useImportSkillFromUrl();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.name.endsWith(".md")) {
      const text = await file.text();
      setImportBody(text);
      if (!importName) setImportName(file.name.replace(/\.md$/, ""));
      setZipEntries([]);
      setZipPick(null);
    } else if (file.name.endsWith(".zip")) {
      const buffer = await file.arrayBuffer();
      const entries = await extractMdFromZip(buffer);
      setZipEntries(entries);
      setZipPick(entries[0]?.name ?? null);
      if (entries[0]) {
        setImportBody(entries[0].body);
        if (!importName)
          setImportName(
            entries[0].name.replace(/\.md$/, "").split("/").pop() ?? "",
          );
      }
    }
  };

  const handleZipPick = (entryName: string) => {
    const entry = zipEntries.find((e) => e.name === entryName);
    if (!entry) return;
    setZipPick(entryName);
    setImportBody(entry.body);
    if (!importName)
      setImportName(entry.name.replace(/\.md$/, "").split("/").pop() ?? "");
  };

  const handleCreate = () => {
    create.mutate(
      { name, description, type, body },
      {
        onSuccess: (s) => {
          onCreated?.(s.id);
          onClose();
        },
      },
    );
  };

  const handleImport = () => {
    importSkill.mutate(
      { name: importName, body: importBody },
      {
        onSuccess: (s) => {
          onCreated?.(s.id);
          onClose();
        },
      },
    );
  };

  const handleImportFromUrl = () => {
    importFromUrl.mutate(
      { url: importUrl, name: urlName },
      {
        onSuccess: (s) => {
          onCreated?.(s.id);
          onClose();
        },
      },
    );
  };

  return (
    <div style={MODAL_OVERLAY} onClick={onClose}>
      <div style={MODAL_BOX} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, flex: 1 }}>Add skill</h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 18,
              color: "var(--text-muted)",
            }}
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            gap: 4,
            borderBottom: "1px solid var(--border)",
            paddingBottom: 8,
          }}
        >
          {(["create", "import", "url"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              style={
                {
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "4px 12px",
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  color: tab === k ? "var(--accent)" : "var(--text-muted)",
                  backgroundColor:
                    tab === k ? "var(--accent-bg)" : "transparent",
                } as React.CSSProperties
              }
            >
              {k === "create"
                ? "Create"
                : k === "import"
                  ? t("drawer.tabs.file")
                  : "Import from URL"}
            </button>
          ))}
        </div>

        {tab === "create" && (
          <>
            <FormField label="Name">
              <TextInput
                value={name}
                onChange={setName}
                placeholder="pr-quality-rubric"
              />
            </FormField>
            <FormField label="Description">
              <TextInput
                value={description}
                onChange={setDescription}
                placeholder="What this skill checks…"
              />
            </FormField>
            <FormField label="Type">
              <SelectInput
                value={type}
                onChange={setType}
                options={TYPE_OPTIONS}
              />
            </FormField>
            <FormField label="Body (Markdown)">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                placeholder="# Rule&#10;Describe the rule…"
                style={{
                  fontFamily: "monospace",
                  fontSize: 12,
                  width: "100%",
                  padding: 8,
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  background: "var(--bg-elevated)",
                  color: "var(--text-primary)",
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
            </FormField>
            <Button
              kind="primary"
              onClick={handleCreate}
              disabled={!name || !body || create.isPending}
            >
              {create.isPending ? "Creating…" : "Create skill"}
            </Button>
          </>
        )}

        {tab === "import" && (
          <>
            <FormField label={t("file.nameLabel")} hint={t("file.nameHint")}>
              <TextInput
                value={importName}
                onChange={setImportName}
                placeholder={t("file.namePlaceholder")}
              />
            </FormField>
            <FormField label="Type">
              <SelectInput
                value={importType}
                onChange={setImportType}
                options={TYPE_OPTIONS}
              />
            </FormField>
            <FormField label="File (.md or .zip)">
              <input
                type="file"
                accept=".md,.zip"
                onChange={handleFile}
                style={{ fontSize: 13 }}
              />
            </FormField>
            {zipEntries.length > 1 && (
              <FormField label="Select file from ZIP">
                <SelectInput
                  value={zipPick ?? ""}
                  onChange={handleZipPick}
                  options={zipEntries.map((e) => ({
                    value: e.name,
                    label: e.name,
                  }))}
                />
              </FormField>
            )}
            {importBody && (
              <FormField label={t("file.bodyLabel")} hint={t("file.bodyHint")}>
                <textarea
                  value={importBody}
                  onChange={(e) => setImportBody(e.target.value)}
                  rows={6}
                  style={{
                    fontFamily: "monospace",
                    fontSize: 12,
                    width: "100%",
                    padding: 8,
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    background: "var(--bg-elevated)",
                    color: "var(--text-primary)",
                    resize: "vertical",
                    boxSizing: "border-box",
                  }}
                />
              </FormField>
            )}
            <Button
              kind="primary"
              onClick={handleImport}
              disabled={!importName || !importBody || importSkill.isPending}
            >
              {importSkill.isPending ? t("file.importing") : t("file.import")}
            </Button>
          </>
        )}

        {tab === "url" && (
          <>
            <FormField label="URL (https:// only)">
              <TextInput
                value={importUrl}
                onChange={setImportUrl}
                placeholder="https://raw.githubusercontent.com/org/repo/main/skill.md"
              />
            </FormField>
            <FormField label="Skill name">
              <TextInput
                value={urlName}
                onChange={setUrlName}
                placeholder="my-skill"
              />
            </FormField>
            <Button
              kind="primary"
              onClick={handleImportFromUrl}
              disabled={
                !importUrl.startsWith("https://") ||
                !urlName.trim() ||
                importFromUrl.isPending
              }
            >
              {importFromUrl.isPending ? "Importing…" : "Import from URL"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
