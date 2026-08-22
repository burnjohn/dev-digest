"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Modal, FormField, TextInput, SelectInput, Textarea } from "@devdigest/ui";
import type { SkillType } from "../../../../lib/hooks/skills";
import { useCreateSkill } from "../../../../lib/hooks/skills";

const TYPE_OPTIONS: Array<{ value: SkillType; label: string }> = [
  { value: "rubric", label: "Rubric — scoring criteria" },
  { value: "convention", label: "Convention — code/style rules" },
  { value: "security", label: "Security — security checks" },
  { value: "custom", label: "Custom" },
];

const MODAL_WIDTH = 560;

/** Create-skill modal — name/description/type/body. */
export function CreateSkillModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const create = useCreateSkill();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");
  const [body, setBody] = React.useState("");

  const submit = async () => {
    const skill = await create.mutateAsync({
      name: name.trim() || t("create.defaultName"),
      description,
      type,
      source: "manual",
      body,
      enabled: true,
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
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Button kind="ghost" onClick={onClose}>
            {t("create.cancel")}
          </Button>
          <Button kind="primary" icon="Plus" onClick={submit} disabled={create.isPending}>
            {create.isPending ? t("create.creating") : t("create.create")}
          </Button>
        </div>
      }
    >
      <div style={{ padding: 24 }}>
        <FormField label={t("create.fields.name")} required>
          <TextInput value={name} onChange={setName} placeholder={t("create.fields.namePlaceholder")} />
        </FormField>
        <FormField label={t("create.fields.description")}>
          <TextInput
            value={description}
            onChange={setDescription}
            placeholder={t("create.fields.descriptionPlaceholder")}
          />
        </FormField>
        <FormField label={t("create.fields.type")}>
          <SelectInput
            value={type}
            onChange={(v) => setType(v as SkillType)}
            options={TYPE_OPTIONS}
          />
        </FormField>
        <FormField label={t("create.fields.body")}>
          <Textarea
            value={body}
            onChange={setBody}
            rows={6}
            mono
            placeholder={t("create.fields.bodyPlaceholder")}
          />
        </FormField>
      </div>
    </Modal>
  );
}
