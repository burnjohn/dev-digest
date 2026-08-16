"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  FormField,
  TextInput,
  SelectInput,
  Toggle,
  Modal,
  Badge,
} from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useDeleteSkill, useUpdateSkill } from "../../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../../lib/toast";
import { SKILL_TYPES } from "../../../../../_components/SkillsListView/constants";
import { MAX_SKILL_BODY_CHARS } from "../../constants";
import { MarkdownEditor } from "../MarkdownEditor";
import { s } from "./styles";

/**
 * Config tab — name, description, type, the body editor, and the enabled toggle.
 *
 * Plain `useState` per field (there is no react-hook-form in this repo). The
 * parent remounts this via `key={skill.id}`, which is what resets the form when
 * you switch skills — see AgentEditor for the same trick and why.
 */
export function ConfigTab({ skill, usedBy }: { skill: Skill; usedBy: number }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const toast = useToast();
  const update = useUpdateSkill();
  const del = useDeleteSkill();

  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  // Stable id prefix so each FormField <label> can point at its control.
  const fieldId = React.useId();
  const bodyFieldId = `${fieldId}-body`;

  const bodyDirty = body !== skill.body;
  const dirty =
    bodyDirty || name !== skill.name || description !== skill.description || type !== skill.type;
  const tooLong = body.length > MAX_SKILL_BODY_CHARS;
  const canSave = dirty && !tooLong && name.trim().length > 0 && !update.isPending;

  const save = async () => {
    if (!canSave) return;
    const saved = await update.mutateAsync({
      id: skill.id,
      patch: { name: name.trim(), description, type, body },
    });
    toast.success(t("editor.saved", { name: saved.name }));
  };

  const remove = async () => {
    await del.mutateAsync(skill.id);
    toast.success(t("editor.delete.success", { name: skill.name }));
    setConfirmDelete(false);
    router.push("/skills");
  };

  return (
    <div style={s.wrap}>
      <div style={s.headerRow}>
        <h2 style={s.h2}>{t("editor.config.heading")}</h2>
        <Badge color="var(--text-muted)" mono>
          {t("preview.version", { version: skill.version })}
        </Badge>
        <div style={s.enabledBox}>
          <span style={s.enabledLabel}>{t("editor.enabled")}</span>
          <Toggle
            on={skill.enabled}
            ariaLabel={t("editor.enabled")}
            onChange={(enabled) => update.mutate({ id: skill.id, patch: { enabled } })}
          />
        </div>
      </div>

      <FormField
        label={t("editor.config.nameLabel")}
        hint={t("editor.config.nameHint")}
        htmlFor={`${fieldId}-name`}
        required
      >
        <TextInput id={`${fieldId}-name`} value={name} onChange={setName} spellCheck={false} />
      </FormField>

      <FormField
        label={t("editor.config.descriptionLabel")}
        hint={t("editor.config.descriptionHint")}
        htmlFor={`${fieldId}-description`}
      >
        <TextInput id={`${fieldId}-description`} value={description} onChange={setDescription} />
      </FormField>

      <FormField label={t("editor.config.typeLabel")} htmlFor={`${fieldId}-type`}>
        <SelectInput
          id={`${fieldId}-type`}
          value={type}
          onChange={(v) => setType(v as SkillType)}
          options={SKILL_TYPES.map((k) => ({ value: k, label: t(`listItem.type.${k}`) }))}
        />
      </FormField>

      <FormField
        label={t("editor.config.bodyLabel")}
        hint={t("editor.config.bodyHint")}
        htmlFor={bodyFieldId}
      >
        <MarkdownEditor
          id={bodyFieldId}
          name={name}
          value={body}
          onChange={setBody}
          dirty={bodyDirty}
        />
      </FormField>

      {tooLong && (
        <p style={s.error} role="alert">
          {t("file.bodyTooLong", { count: body.length, max: MAX_SKILL_BODY_CHARS })}
        </p>
      )}

      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={save} disabled={!canSave}>
          {update.isPending ? t("editor.saving") : t("editor.save")}
        </Button>
        <Button kind="ghost" icon="Trash" onClick={() => setConfirmDelete(true)}>
          {t("editor.delete.action")}
        </Button>
      </div>

      {confirmDelete && (
        <Modal
          width={440}
          title={t("editor.delete.title", { name: skill.name })}
          onClose={() => setConfirmDelete(false)}
          footer={
            <div style={s.modalFooter}>
              <Button kind="ghost" onClick={() => setConfirmDelete(false)}>
                {t("editor.delete.cancel")}
              </Button>
              <Button kind="danger" icon="Trash" onClick={remove} disabled={del.isPending}>
                {t("editor.delete.confirm")}
              </Button>
            </div>
          }
        >
          <p style={s.modalBody}>{t("editor.delete.body")}</p>
          {/* Deleting cascades through agent_skills, so say out loud how many
              agents silently lose this rule. */}
          {usedBy > 0 && (
            <p style={s.modalWarn}>{t("editor.delete.linked", { count: usedBy })}</p>
          )}
        </Modal>
      )}
    </div>
  );
}
