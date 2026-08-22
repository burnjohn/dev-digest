"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Modal, FormField } from "@devdigest/ui";
import type { SkillType } from "../../../../lib/hooks/skills";
import { useCreateSkill } from "../../../../lib/hooks/skills";

interface ParsedSkill {
  name?: string;
  description?: string;
  type?: string;
  body: string;
}

function parseFrontmatter(content: string): ParsedSkill {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { body: content.trim() };
  const fm = match[1]!;
  const body = match[2]!.trim();
  const get = (key: string) =>
    fm.match(new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, "m"))?.[1]?.trim();
  return { name: get("name"), description: get("description"), type: get("type"), body };
}

async function parseFile(file: File): Promise<ParsedSkill | null> {
  if (file.name.endsWith(".md")) {
    const content = await file.text();
    return parseFrontmatter(content);
  }
  if (file.name.endsWith(".zip")) {
    try {
      // JSZip is an optional peer dep — installed via STEP 1.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const JSZip = ((await import("jszip" as any)) as any).default as {
        loadAsync: (data: File) => Promise<{
          files: Record<string, { name: string; dir: boolean; async: (type: "string") => Promise<string> }>;
        }>;
      };
      const zip = await JSZip.loadAsync(file);
      const mdFile = Object.values(zip.files).find(
        (f) => f.name.endsWith(".md") && !f.dir,
      );
      if (!mdFile) return null;
      const content = await mdFile.async("string");
      return parseFrontmatter(content);
    } catch {
      return null;
    }
  }
  return null;
}

const VALID_TYPES: SkillType[] = ["rubric", "convention", "security", "custom"];

export function ImportModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const create = useCreateSkill();

  const [parsed, setParsed] = React.useState<ParsedSkill | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setLoading(true);
    const result = await parseFile(file);
    setLoading(false);
    if (!result || !result.body) {
      setError(t("import.parseError"));
    } else {
      setParsed(result);
    }
  };

  const handleConfirm = async () => {
    if (!parsed) return;
    const rawType = parsed.type ?? "custom";
    const safeType: SkillType = VALID_TYPES.includes(rawType as SkillType)
      ? (rawType as SkillType)
      : "custom";

    const skill = await create.mutateAsync({
      name: parsed.name ?? "Imported Skill",
      description: parsed.description ?? "",
      type: safeType,
      source: "imported_url",
      body: parsed.body,
      enabled: false, // starts disabled until vetted
    });
    onClose();
    router.push(`/skills/${skill.id}?tab=config`);
  };

  return (
    <Modal
      width={560}
      title={t("import.title")}
      subtitle={t("import.description")}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Button kind="ghost" onClick={onClose}>
            {t("import.cancel")}
          </Button>
          {parsed && (
            <Button kind="primary" icon="Upload" onClick={handleConfirm} disabled={create.isPending}>
              {t("import.confirm")}
            </Button>
          )}
        </div>
      }
    >
      <div style={{ padding: 24 }}>
        {!parsed ? (
          <FormField label={t("import.dropzone")}>
            <div
              style={{
                border: "2px dashed var(--border)",
                borderRadius: 8,
                padding: "32px 24px",
                textAlign: "center",
                cursor: "pointer",
                position: "relative",
              }}
            >
              <input
                type="file"
                accept=".md,.zip"
                onChange={handleFile}
                disabled={loading}
                style={{
                  position: "absolute",
                  inset: 0,
                  opacity: 0,
                  cursor: "pointer",
                  width: "100%",
                  height: "100%",
                }}
              />
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                {loading ? "Parsing…" : t("import.dropzone")}
              </span>
            </div>
            {error && (
              <div style={{ marginTop: 8, fontSize: 13, color: "var(--crit)" }}>{error}</div>
            )}
          </FormField>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{t("import.preview")}</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Row label={t("import.name")} value={parsed.name ?? "—"} />
              <Row label={t("import.type")} value={parsed.type ?? "—"} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                {t("import.body")}
              </div>
              <pre
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: 12,
                  fontSize: 12,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  maxHeight: 200,
                  overflow: "auto",
                  margin: 0,
                }}
              >
                {parsed.body.slice(0, 500)}
                {parsed.body.length > 500 ? "\n…" : ""}
              </pre>
            </div>
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 6,
                background: "var(--warn-bg, #2a1d00)",
                border: "1px solid var(--warn, #d97706)",
                fontSize: 13,
                color: "var(--text-secondary)",
              }}
            >
              ⚠ {t("import.trustWarning")}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 12, fontSize: 13 }}>
      <span style={{ color: "var(--text-muted)", minWidth: 80 }}>{label}</span>
      <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{value}</span>
    </div>
  );
}
