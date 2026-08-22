"use client";
import React from "react";
import { FormField, TextInput, SelectInput, Textarea, Toggle, Button } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useUpdateSkill } from "../../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../../lib/toast";

const TYPE_OPTIONS = [
  { value: "rubric", label: "Rubric" },
  { value: "convention", label: "Convention" },
  { value: "security", label: "Security" },
  { value: "custom", label: "Custom" },
];

function estimateTokens(text: string) {
  return Math.round(text.length / 4);
}

export function ConfigTab({ skill }: { skill: Skill }) {
  const toast = useToast();
  const update = useUpdateSkill();

  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);
  const [enabled, setEnabled] = React.useState(skill.enabled);
  const [versionMessage, setVersionMessage] = React.useState("");

  React.useEffect(() => {
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
    setEnabled(skill.enabled);
    setVersionMessage("");
  }, [skill.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const bodyDirty = body !== skill.body;
  const tokens = estimateTokens(body);

  const save = () => {
    update.mutate(
      {
        id: skill.id,
        patch: {
          name,
          description,
          type,
          body,
          enabled,
          ...(versionMessage ? { version_message: versionMessage } : {}),
        },
      },
      {
        onSuccess: (d) => {
          toast.success(`Skill saved (v${d.version})`);
          setVersionMessage("");
        },
      },
    );
  };

  return (
    <div style={{ maxWidth: 640, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, flex: 1 }}>Configuration</h2>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          Enabled
          <Toggle on={enabled} onChange={setEnabled} size={16} />
        </label>
      </div>
      <FormField label="Name" required>
        <TextInput value={name} onChange={setName} />
      </FormField>
      <FormField label="Description" hint="Write as a directive — what this skill instructs the agent to do.">
        <TextInput value={description} onChange={setDescription} />
      </FormField>
      <FormField label="Type">
        <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={TYPE_OPTIONS} />
      </FormField>
      <FormField
        label={
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Skill body
            {bodyDirty && (
              <span style={{ fontSize: 11, color: "var(--warning-text)", fontWeight: 500 }}>unsaved</span>
            )}
            <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>~{tokens} tokens</span>
          </span>
        }
        hint="Saving a changed body creates a new immutable version."
      >
        <Textarea value={body} onChange={setBody} rows={12} mono />
      </FormField>
      {bodyDirty && (
        <FormField label="Version message (optional)" hint="What changed in this version?">
          <TextInput value={versionMessage} onChange={setVersionMessage} placeholder="Tightened scope rule…" />
        </FormField>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Button kind="primary" icon="Check" onClick={save} disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save"}
        </Button>
        {update.isSuccess && (
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Saved (v{update.data?.version})</span>
        )}
      </div>
    </div>
  );
}
