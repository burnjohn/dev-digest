/* ConfigTab — name/description/type/body + the enabled toggle. Always
   editable, no separate edit-mode toggle: the "unsaved" badge on the body
   editor is what tells the user a Save is pending. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Icon, SelectInput, TextInput, Textarea, Toggle } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useDeleteSkill, useUpdateSkill } from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";
import { SKILL_TYPES } from "../../../SkillsListView/constants";
import { isUntrusted } from "../../../SkillsListView/helpers";
import { SkillBodyEditor } from "./SkillBodyEditor";
import { s } from "./styles";

/**
 * No effect re-syncs the fields below from `skill`: the parent keys
 * `SkillDetail` by `skill.id`, so selecting a different skill remounts this
 * component and the `useState` initializers run again. A background refetch
 * (e.g. another tab's mutation) therefore cannot silently overwrite an edit in
 * progress here.
 */
export function ConfigTab({ skill, onDeleted }: { skill: Skill; onDeleted?: () => void }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const update = useUpdateSkill();
  const del = useDeleteSkill();

  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);

  const unsaved =
    name !== skill.name ||
    description !== skill.description ||
    type !== skill.type ||
    body !== skill.body;

  const untrusted = isUntrusted(skill);

  const save = () =>
    update.mutate(
      { id: skill.id, patch: { name, description, type, body } },
      {
        onSuccess: (data) =>
          toast.success(t("preview.savedToast", { name: data.name, version: data.version })),
      },
    );

  const remove = () => {
    if (!window.confirm(t("preview.deleteConfirm", { name: skill.name }))) return;
    del.mutate(skill.id, {
      onSuccess: () => {
        toast.success(t("preview.deletedToast", { name: skill.name }));
        onDeleted?.();
      },
    });
  };

  return (
    <div>
      <div style={s.header}>
        <h2 style={s.h2}>{t("config.title")}</h2>
        <label style={s.enabledLabel}>
          {t("config.enabled")}
          <Toggle
            on={skill.enabled}
            onChange={(enabled) => update.mutate({ id: skill.id, patch: { enabled } })}
            size={16}
          />
        </label>
      </div>

      {untrusted && (
        <div style={s.notice}>
          <Icon.AlertTriangle size={14} style={s.noticeIcon} />
          <span>{t("preview.untrustedNotice")}</span>
        </div>
      )}

      <FormField label={t("config.nameLabel")} required>
        <TextInput value={name} onChange={setName} />
      </FormField>
      <FormField label={t("config.descriptionLabel")} hint={t("config.descriptionHint")}>
        <Textarea value={description} onChange={setDescription} rows={3} />
      </FormField>
      <FormField label={t("config.typeLabel")}>
        <SelectInput
          value={type}
          onChange={(v) => setType(v as SkillType)}
          mono={false}
          options={SKILL_TYPES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }))}
        />
      </FormField>
      <FormField label={t("config.bodyLabel")} hint={t("config.bodyHint")} required>
        <SkillBodyEditor
          filename={`${name || skill.name}.md`}
          value={body}
          onChange={setBody}
          unsaved={unsaved}
        />
      </FormField>

      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={save} disabled={update.isPending || !unsaved}>
          {update.isPending ? t("config.saving") : t("config.save")}
        </Button>
        <div style={s.spacer} />
        <Button kind="danger" size="sm" icon="Trash" onClick={remove} disabled={del.isPending}>
          {t("preview.delete")}
        </Button>
      </div>
    </div>
  );
}
