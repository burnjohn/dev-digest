"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Modal, FormField, TextInput, SelectInput } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useCreateSkill } from "../../../../../../lib/hooks/skills";
import { NEW_SKILL_BODY } from "../../constants";
import { SKILL_TYPES } from "../../../../../../lib/skill-types";
import { s } from "./styles";

const MODAL_WIDTH = 520;

/**
 * Create-from-scratch modal. Deliberately minimal — name, description, type —
 * because the body is written in the editor, which has the line gutter and the
 * token counter. Creating drops you straight into that editor.
 */
export function CreateSkillModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const create = useCreateSkill();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !create.isPending;

  const submit = async () => {
    if (!canSubmit) return;
    const skill = await create.mutateAsync({
      name: trimmed,
      description: description.trim(),
      type,
      source: "manual",
      body: NEW_SKILL_BODY,
    });
    onClose();
    router.push(`/skills/${skill.id}?tab=config`);
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("create.title")}
      subtitle={t("create.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("create.cancel")}
          </Button>
          <Button kind="primary" icon="Plus" onClick={submit} disabled={!canSubmit}>
            {create.isPending ? t("create.creating") : t("create.submit")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <FormField label={t("create.nameLabel")} required>
          <TextInput
            value={name}
            onChange={setName}
            placeholder={t("create.namePlaceholder")}
          />
        </FormField>
        <FormField label={t("create.descriptionLabel")}>
          <TextInput
            value={description}
            onChange={setDescription}
            placeholder={t("create.descriptionPlaceholder")}
          />
        </FormField>
        <FormField label={t("create.typeLabel")}>
          <SelectInput
            value={type}
            onChange={(v) => setType(v as SkillType)}
            options={SKILL_TYPES.map((k) => ({ value: k, label: t(`listItem.type.${k}`) }))}
          />
        </FormField>
      </div>
    </Modal>
  );
}
