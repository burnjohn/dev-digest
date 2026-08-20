/* NewSkillModal — name, description and type for a skill created from scratch.
   The body is written in the editor's Config tab, which this navigates to. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, FormField, Modal, SelectInput, TextInput } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useCreateSkill } from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";
import { TYPE_VALUES } from "../../../../constants";

export function NewSkillModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const toast = useToast();
  const create = useCreateSkill();

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");

  const submit = async () => {
    try {
      const skill = await create.mutateAsync({
        name: name.trim(),
        description,
        type,
        // A starter body so the skill is valid immediately; the Config tab is
        // where it actually gets written.
        body: t("create.starterBody", { name: name.trim() }),
        source: "manual",
      });
      toast.success(t("preview.createdToast", { name: skill.name }));
      onClose();
      router.push(`/skills/${skill.id}?tab=config`);
    } catch {
      toast.error(t("preview.saveError"));
    }
  };

  return (
    <Modal
      width={520}
      title={t("create.title")}
      subtitle={t("create.subtitle")}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 10 }}>
          <Button
            kind="primary"
            icon="Plus"
            onClick={submit}
            disabled={name.trim().length === 0 || create.isPending}
          >
            {create.isPending ? t("preview.saving") : t("create.create")}
          </Button>
          <Button kind="ghost" onClick={onClose}>
            {t("preview.cancel")}
          </Button>
        </div>
      }
    >
      <FormField label={t("preview.fields.name")} required>
        <TextInput value={name} onChange={setName} placeholder={t("preview.fields.namePlaceholder")} />
      </FormField>
      <FormField label={t("preview.fields.description")} hint={t("preview.fields.descriptionHint")}>
        <TextInput
          value={description}
          onChange={setDescription}
          placeholder={t("preview.fields.descriptionPlaceholder")}
        />
      </FormField>
      <FormField label={t("preview.fields.type")}>
        <SelectInput
          value={type}
          onChange={(v) => setType(v as SkillType)}
          options={TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }))}
        />
      </FormField>
    </Modal>
  );
}
