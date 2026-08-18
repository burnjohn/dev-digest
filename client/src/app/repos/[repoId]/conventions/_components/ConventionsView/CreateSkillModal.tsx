/* CreateSkillModal — merges the bundle of selected accepted candidates into
   one editable skill draft (name/description/type/enabled + generated
   markdown body), then saves it through the existing skill-create flow.
   Attaching the new skill to an agent reuses the existing Agent editor
   Skills tab — not duplicated here. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FormField, Modal, SelectInput, TextInput, Textarea, Toggle, Button } from "@devdigest/ui";
import type { ConventionCandidate, Skill, SkillType } from "@devdigest/shared";
import { useCreateSkill } from "@/lib/hooks";
import { useToast } from "@/lib/toast";
import { SKILL_TYPES } from "@/app/skills/_components/SkillsListView/constants";
import { buildSkillBody, defaultSkillName } from "./helpers";
import { s } from "./styles";

export function CreateSkillModal({
  candidates,
  repoFullName,
  onClose,
  onCreated,
}: {
  candidates: ConventionCandidate[];
  repoFullName: string | null | undefined;
  onClose: () => void;
  onCreated?: (skill: Skill) => void;
}) {
  const t = useTranslations("conventions");
  const toast = useToast();
  const create = useCreateSkill();

  const initialName = defaultSkillName(repoFullName);
  const [name, setName] = React.useState(initialName);
  const [description, setDescription] = React.useState(
    t("createSkill.defaultDescription", { count: candidates.length, repo: repoFullName ?? initialName }),
  );
  const [type, setType] = React.useState<SkillType>("convention");
  const [enabled, setEnabled] = React.useState(true);
  const [body, setBody] = React.useState(() => buildSkillBody(initialName, candidates));

  const canCreate = name.trim().length > 0 && body.trim().length > 0;

  const save = () => {
    create.mutate(
      { name, description, type, body, source: "extracted", enabled },
      {
        onSuccess: (skill) => {
          toast.success(t("createSkill.success", { name: skill.name }));
          onCreated?.(skill);
          onClose();
        },
      },
    );
  };

  return (
    <Modal
      width={760}
      title={t("createSkill.title")}
      subtitle={defaultSkillName(repoFullName)}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="secondary" size="sm" onClick={onClose}>
            {t("createSkill.cancel")}
          </Button>
          <Button kind="primary" size="sm" icon="Sparkles" onClick={save} disabled={!canCreate || create.isPending}>
            {create.isPending ? t("createSkill.creating") : t("createSkill.create")}
          </Button>
        </div>
      }
    >
      <div style={s.modalBody}>
        <div style={s.modalBanner}>
          {t("createSkill.mergedFrom", { count: candidates.length, repo: repoFullName ?? initialName })}
        </div>

        <FormField label={t("createSkill.nameLabel")} required>
          <TextInput value={name} onChange={setName} />
        </FormField>

        <FormField label={t("createSkill.descriptionLabel")}>
          <Textarea value={description} onChange={setDescription} rows={2} />
        </FormField>

        <div style={s.modalRow}>
          <div style={s.modalCol}>
            <FormField label={t("createSkill.typeLabel")}>
              <SelectInput
                value={type}
                onChange={(v) => setType(v as SkillType)}
                mono={false}
                options={SKILL_TYPES.map((v) => ({ value: v, label: v }))}
              />
            </FormField>
          </div>
          <div style={s.modalCol}>
            <FormField label={t("createSkill.enabledLabel")} hint={t("createSkill.enabledHint")}>
              <div style={s.enabledRow}>
                <Toggle on={enabled} onChange={setEnabled} />
              </div>
            </FormField>
          </div>
        </div>

        <FormField label={t("createSkill.bodyLabel")} required>
          <Textarea value={body} onChange={setBody} rows={16} mono />
        </FormField>
      </div>
    </Modal>
  );
}
