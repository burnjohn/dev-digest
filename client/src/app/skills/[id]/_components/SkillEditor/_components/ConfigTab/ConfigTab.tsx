/* ConfigTab — name, description, type, body editor with token counter + line numbers. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  FormField,
  TextInput,
  SelectInput,
  Toggle,
} from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useUpdateSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/contexts/toast";
import type { SkillType } from "@devdigest/shared";

const TYPE_OPTIONS = [
  { value: "rubric", label: "Rubric" },
  { value: "convention", label: "Convention" },
  { value: "security", label: "Security" },
  { value: "custom", label: "Custom" },
];

export function ConfigTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const update = useUpdateSkill();

  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);
  const [enabled, setEnabled] = React.useState(skill.enabled);

  React.useEffect(() => {
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
    setEnabled(skill.enabled);
  }, [skill.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty =
    name !== skill.name ||
    description !== skill.description ||
    type !== skill.type ||
    body !== skill.body ||
    enabled !== skill.enabled;

  const tokenCount = Math.ceil(body.length / 4);
  const lines = body.split("\n");

  const handleSave = () => {
    update.mutate(
      { id: skill.id, patch: { name, description, type, body, enabled } },
      { onSuccess: () => toast.success("Skill saved.") },
    );
  };

  return (
    <div
      style={{
        padding: 28,
        display: "flex",
        flexDirection: "column",
        gap: 20,
        maxWidth: 720,
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, flex: 1 }}>
          {name || "Untitled skill"}
        </h2>
        {dirty && (
          <span style={{ fontSize: 11, color: "var(--warn)", fontWeight: 600 }}>
            unsaved
          </span>
        )}
        <Toggle on={enabled} size={14} onChange={(v) => setEnabled(v)} />
        <Button
          kind="primary"
          size="sm"
          onClick={handleSave}
          disabled={!dirty || update.isPending}
        >
          {update.isPending ? "Saving…" : t("preview.save")}
        </Button>
      </div>

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
          onChange={(v) => setType(v as SkillType)}
          options={TYPE_OPTIONS}
        />
      </FormField>

      {/* Body editor */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-secondary)",
              flex: 1,
            }}
          >
            {t("preview.bodyLabel")}
          </label>
          <span
            style={{
              fontSize: 11,
              fontFamily: "monospace",
              color: "var(--text-muted)",
            }}
          >
            {name
              ? `${name.toLowerCase().replace(/\s+/g, "-")}.md`
              : "skill.md"}
          </span>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            ~{tokenCount.toLocaleString()} tokens
          </span>
        </div>
        <div
          style={{
            position: "relative",
            border: "1px solid var(--border)",
            borderRadius: 8,
            overflow: "hidden",
            background: "var(--bg-elevated)",
            display: "flex",
          }}
        >
          {/* Line numbers */}
          <div
            aria-hidden
            style={{
              padding: "10px 8px",
              fontSize: 12,
              lineHeight: "1.5",
              fontFamily: "monospace",
              color: "var(--text-muted)",
              background: "var(--bg-surface)",
              borderRight: "1px solid var(--border)",
              userSelect: "none",
              minWidth: 36,
              textAlign: "right",
              whiteSpace: "pre",
            }}
          >
            {lines.map((_, i) => i + 1).join("\n")}
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={Math.max(12, lines.length + 2)}
            spellCheck={false}
            style={{
              flex: 1,
              padding: "10px 12px",
              fontSize: 12,
              lineHeight: "1.5",
              fontFamily: "monospace",
              border: "none",
              outline: "none",
              resize: "vertical",
              background: "transparent",
              color: "var(--text-primary)",
            }}
          />
        </div>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {t("preview.bodyHint")}
        </span>
      </div>
    </div>
  );
}
