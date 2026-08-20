/* ConfigTab — name, description, type and the markdown body. Saving a changed
   body bumps the skill's version and snapshots the old text (Versions tab). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, FormField, SelectInput, TextInput, Toggle } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useDeleteSkill, useUpdateSkill } from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";
import { MAX_VERSION_MESSAGE_CHARS, TYPE_VALUES } from "../../../../constants";
import { approxTokens } from "../../../../helpers";
import { s } from "../../../../styles";

export function ConfigTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const update = useUpdateSkill();
  const del = useDeleteSkill();

  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);
  const [versionMessage, setVersionMessage] = React.useState("");

  // Reset the form when the rail switches to a different skill.
  React.useEffect(() => {
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
    setVersionMessage("");
  }, [skill.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty =
    name !== skill.name ||
    description !== skill.description ||
    type !== skill.type ||
    body !== skill.body;
  const canSave = name.trim().length > 0 && body.trim().length > 0 && dirty && !update.isPending;
  const lineCount = body.split("\n").length;

  const save = async () => {
    try {
      const saved = await update.mutateAsync({
        id: skill.id,
        patch: {
          name,
          description,
          type,
          body,
          // Attached to the version this save writes; blank leaves it unset and
          // the Versions tab falls back to its diff-derived summary.
          ...(versionMessage.trim() ? { version_message: versionMessage.trim() } : {}),
        },
      });
      setVersionMessage("");
      toast.success(t("preview.savedToast", { version: saved.version }));
    } catch {
      toast.error(t("preview.saveError"));
    }
  };

  const remove = async () => {
    if (!window.confirm(t("preview.deleteConfirm", { name: skill.name }))) return;
    await del.mutateAsync(skill.id);
    window.location.href = "/skills";
  };

  return (
    <div>
      <div style={s.sectionRow}>
        <h2 style={s.sectionTitle}>{t("config.title")}</h2>
        <Badge color="var(--text-secondary)" mono>
          {t("preview.version", { version: skill.version })}
        </Badge>
        <span style={s.enabledLabel}>{t("preview.enabled")}</span>
        <Toggle
          on={skill.enabled}
          onChange={(enabled) => update.mutate({ id: skill.id, patch: { enabled } })}
        />
      </div>

      <FormField label={t("preview.fields.name")} required>
        <TextInput value={name} onChange={setName} mono />
      </FormField>

      <FormField label={t("preview.fields.description")} hint={t("preview.fields.descriptionHint")}>
        <TextInput value={description} onChange={setDescription} />
      </FormField>

      <FormField label={t("preview.fields.type")}>
        <SelectInput
          value={type}
          onChange={(v) => setType(v as SkillType)}
          options={TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }))}
        />
      </FormField>

      <FormField label={t("config.bodyLabel")} required hint={t("config.bodyHint")}>
        <div style={s.editorFrame}>
          <div style={s.editorBar}>
            <span className="mono" style={s.editorFilename}>
              {skill.name}.md
            </span>
            {dirty && <Badge color="var(--warning, #d99a2b)">{t("config.unsaved")}</Badge>}
            {/* `~` on purpose: the client has no tokenizer, so this is the same
                chars/4 heuristic the server falls back to. */}
            <span className="mono" style={s.editorTokens}>
              {t("config.tokens", { count: approxTokens(body) })}
            </span>
          </div>
          <div style={s.editorPane}>
            <div className="mono" aria-hidden style={s.gutter}>
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <textarea
              className="mono"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              spellCheck={false}
              aria-label={t("config.bodyLabel")}
              style={s.bodyInput}
            />
          </div>
        </div>
      </FormField>

      <FormField label={t("config.versionMessage")} hint={t("config.versionMessageHint")}>
        <TextInput
          value={versionMessage}
          onChange={setVersionMessage}
          placeholder={t("config.versionMessagePlaceholder")}
          maxLength={MAX_VERSION_MESSAGE_CHARS}
        />
      </FormField>

      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={save} disabled={!canSave}>
          {update.isPending ? t("preview.saving") : t("config.save")}
        </Button>
        <Button kind="ghost" icon="Trash" onClick={remove} disabled={del.isPending}>
          {t("preview.delete")}
        </Button>
      </div>
    </div>
  );
}
