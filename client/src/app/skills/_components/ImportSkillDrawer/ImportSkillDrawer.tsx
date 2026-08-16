/* ImportSkillDrawer — pick a .md or .zip, parse it entirely in the browser,
   preview what will be created, then POST plain JSON to /skills.

   Client-side parsing is what keeps the server free of @fastify/multipart and a
   zip library, and keeps uploads clear of the global 1MB bodyLimit. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Drawer,
  FormField,
  Markdown,
  SelectInput,
  TextInput,
} from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useCreateSkill } from "../../../../lib/hooks/skills";
import { useToast } from "../../../../lib/toast";
import { SKILL_TYPES } from "../SkillsListView/constants";
import {
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_ENTRIES,
  SkillParseError,
  parseSkillUpload,
  type ParsedSkillFile,
} from "./parse";
import { s } from "./styles";

/** Mirrors MAX_SKILL_BODY_CHARS on the server; the server schema is the real gate. */
const MAX_SKILL_BODY_CHARS = 8_000;

export function ImportSkillDrawer({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const toast = useToast();
  const create = useCreateSkill();

  const [parsed, setParsed] = React.useState<ParsedSkillFile | null>(null);
  const [sourceFile, setSourceFile] = React.useState<string>("");
  const [error, setError] = React.useState<string | null>(null);
  const [reading, setReading] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);

  // Editable preview fields — the parser cannot infer a type, so the user picks.
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");

  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setReading(true);
    try {
      if (file.size > MAX_ARCHIVE_BYTES) {
        setError(t("file.tooLarge", { max: Math.round(MAX_ARCHIVE_BYTES / (1024 * 1024)) }));
        return;
      }
      const result = parseSkillUpload(await file.arrayBuffer(), file.name);
      setParsed(result);
      setSourceFile(file.name);
      setName(result.name ?? "");
      setDescription(result.description ?? "");
    } catch (err) {
      const { key, values } = messageKeyFor(err);
      setError(t(key, values));
      setParsed(null);
    } finally {
      setReading(false);
    }
  };

  const bodyLength = parsed?.body.length ?? 0;
  const tooLong = bodyLength > MAX_SKILL_BODY_CHARS;
  const canImport = !!parsed && !tooLong && name.trim().length > 0 && !create.isPending;

  const submit = async () => {
    if (!canImport || !parsed) return;
    const skill = await create.mutateAsync({
      name: name.trim(),
      description: description.trim(),
      type,
      source: "imported_file",
      body: parsed.body,
      // Arriving DISABLED is the only real safeguard: an enabled skill body is
      // injected verbatim into every review prompt for the agents it's linked
      // to, so an import must never become live without someone reading it.
      enabled: false,
      evidence_files: [parsed.usedEntry ?? sourceFile, ...parsed.skipped].slice(0, 50),
    });
    toast.success(t("file.success", { name: skill.name }));
    onClose();
    router.push(`/skills/${skill.id}?tab=config`);
  };

  return (
    <Drawer
      width={620}
      title={t("drawer.title")}
      subtitle={t("drawer.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("create.cancel")}
          </Button>
          <Button kind="primary" icon="Upload" onClick={submit} disabled={!canImport}>
            {create.isPending ? t("file.importing") : t("file.import")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        {/* ---- picker ---- */}
        <FormField label={t("file.pickLabel")} hint={t("file.zipHint")}>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void handleFile(file);
            }}
            style={s.dropZone(dragging)}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".md,.markdown,.zip"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                // Reset so picking the SAME file again still fires onChange.
                e.target.value = "";
              }}
              style={s.hiddenInput}
            />
            <Button kind="secondary" size="sm" icon="Upload" onClick={() => inputRef.current?.click()}>
              {t("file.pickAction")}
            </Button>
            <span style={s.dropHint}>{reading ? t("file.reading") : t("file.dropHint")}</span>
          </div>
        </FormField>

        {error && (
          <p style={s.error} role="alert">
            {error}
          </p>
        )}

        {/* ---- preview ---- */}
        {parsed && (
          <>
            <FormField label={t("create.nameLabel")} required>
              <TextInput value={name} onChange={setName} placeholder={t("create.namePlaceholder")} />
            </FormField>
            <FormField label={t("create.descriptionLabel")}>
              <TextInput value={description} onChange={setDescription} />
            </FormField>
            <FormField label={t("create.typeLabel")}>
              <SelectInput
                value={type}
                onChange={(v) => setType(v as SkillType)}
                options={SKILL_TYPES.map((k) => ({ value: k, label: t(`listItem.type.${k}`) }))}
              />
            </FormField>

            {parsed.skipped.length > 0 && (
              <div style={s.skipped}>
                <div style={s.skippedHead}>
                  <Badge color="var(--text-muted)" icon="File">
                    {t("file.skipped", { count: parsed.skipped.length })}
                  </Badge>
                </div>
                <ul style={s.skippedList}>
                  {parsed.skipped.map((n) => (
                    <li key={n} className="mono" style={s.skippedItem}>
                      {n}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {tooLong && (
              <p style={s.error} role="alert">
                {t("file.bodyTooLong", { count: bodyLength, max: MAX_SKILL_BODY_CHARS })}
              </p>
            )}

            {/* The trust banner. Under this product's design a skill body is a
                trusted INSTRUCTION, not delimiter-wrapped data — so the only
                protection is the user reading it before enabling. Say so. */}
            <p style={s.trust}>{t("preview.trustNotice")}</p>

            <div style={s.previewCard}>
              <Markdown>{parsed.body}</Markdown>
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}

/**
 * Map a parse failure to a message key + interpolation values.
 *
 * Returns the key rather than a rendered string so the caller does the `t()`
 * call — next-intl's translator is generically typed against the message tree,
 * and passing it around as a plain function loses that typing.
 */
function messageKeyFor(err: unknown): { key: string; values: Record<string, number> } {
  const mb = Math.round(MAX_ARCHIVE_BYTES / (1024 * 1024));
  if (err instanceof SkillParseError) {
    switch (err.code) {
      case "empty":
        return { key: "file.empty", values: {} };
      case "too_large":
        return { key: "file.tooLarge", values: { max: mb } };
      case "too_many_entries":
        return { key: "file.tooManyEntries", values: { max: MAX_ARCHIVE_ENTRIES } };
      case "no_markdown":
        return { key: "file.noMarkdown", values: {} };
    }
  }
  return { key: "drawer.importFailed", values: {} };
}
