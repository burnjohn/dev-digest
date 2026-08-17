/* CreateSkillFromConventionsModal — turn the accepted conventions into ONE
   `<repo>-conventions` skill.

   The body arrives pre-composed from the server (`skill-draft`): one `##` section
   per accepted rule, each carrying its `file:line` citation. It is editable here
   before anything is persisted — the draft endpoint writes nothing.

   Saving goes through the EXISTING `POST /skills` (source: 'extracted'), then
   stamps `skill_id` on the rules that shipped, then navigates to the new skill's
   Config tab — the same destination the from-scratch CreateSkillModal uses, so
   both create paths end in the same place. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  FormField,
  Icon,
  Modal,
  SelectInput,
  Skeleton,
  TextInput,
  Toggle,
} from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { MarkdownEditor } from "@/components/markdown-editor";
import { useCreateSkill } from "@/lib/hooks/skills";
import { useLinkConventionsToSkill, useSkillDraft } from "@/lib/hooks/conventions";
import { SKILL_TYPES } from "@/lib/skill-types";
import { s } from "./styles";

const MODAL_WIDTH = 720;

export function CreateSkillFromConventionsModal({
  repoId,
  repoName,
  acceptedIds,
  onClose,
}: {
  repoId: string;
  repoName: string;
  acceptedIds: string[];
  onClose: () => void;
}) {
  const t = useTranslations("conventions");
  const router = useRouter();
  const { data: draft, isLoading } = useSkillDraft(repoId);
  const create = useCreateSkill();
  const link = useLinkConventionsToSkill(repoId);

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("convention");
  const [body, setBody] = React.useState("");
  const [enabled, setEnabled] = React.useState(true);
  // The draft arrives after the modal opens, so the fields are seeded once it
  // lands. Keyed on the composed body: a re-fetch of the SAME draft must not
  // clobber edits the user has already made in this modal.
  const [seededFrom, setSeededFrom] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!draft || seededFrom === draft.body) return;
    setName(draft.name);
    setDescription(draft.description);
    setType(draft.type);
    setBody(draft.body);
    setSeededFrom(draft.body);
  }, [draft, seededFrom]);

  const trimmedName = name.trim();
  const canSubmit =
    trimmedName.length > 0 && body.trim().length > 0 && !create.isPending && !link.isPending;

  const submit = async () => {
    if (!canSubmit) return;
    const skill = await create.mutateAsync({
      name: trimmedName,
      description: description.trim(),
      type,
      source: "extracted",
      body,
      enabled,
      ...(draft?.evidence_files ? { evidence_files: draft.evidence_files } : {}),
    });
    // Best-effort provenance: the skill already exists and the user's work is
    // saved, so a failed stamp must not strand them in the modal. The global
    // MutationCache.onError still surfaces it.
    try {
      await link.mutateAsync({ ids: acceptedIds, skill_id: skill.id });
    } catch {
      /* provenance only — navigation proceeds */
    }
    router.push(`/skills/${skill.id}?tab=config`);
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("modal.title")}
      subtitle={
        <span className="mono" translate="no">
          {`${repoName}-conventions`}
        </span>
      }
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <span style={s.footerNote}>
            <Icon.History size={12} aria-hidden="true" />
            {t("modal.savedAs")}
          </span>
          <Button kind="ghost" onClick={onClose}>
            {t("modal.cancel")}
          </Button>
          <Button kind="primary" icon="Sparkles" onClick={submit} disabled={!canSubmit}>
            {create.isPending || link.isPending ? t("modal.submitting") : t("modal.submit")}
          </Button>
        </div>
      }
    >
      <div style={{ padding: "18px 24px" }}>
        {isLoading || !draft ? (
          <div style={s.body}>
            <Skeleton height={40} />
            <Skeleton height={200} />
          </div>
        ) : (
          <div style={s.body}>
            <div style={s.banner}>
              <Icon.Link size={14} aria-hidden="true" />
              <span>
                {t("modal.mergedFrom", { count: acceptedIds.length, repo: repoName })}
              </span>
            </div>

            <FormField label={t("modal.nameLabel")} required htmlFor="conv-skill-name">
              <TextInput id="conv-skill-name" value={name} onChange={setName} mono />
            </FormField>

            <FormField label={t("modal.descriptionLabel")} htmlFor="conv-skill-desc">
              <TextInput id="conv-skill-desc" value={description} onChange={setDescription} />
            </FormField>

            <div style={s.row}>
              <FormField label={t("modal.typeLabel")} htmlFor="conv-skill-type">
                <SelectInput
                  id="conv-skill-type"
                  value={type}
                  onChange={(v) => setType(v as SkillType)}
                  options={SKILL_TYPES.map((k) => ({
                    value: k,
                    label: t(`modal.skillType.${k}`),
                  }))}
                />
              </FormField>
              <FormField label={t("modal.enabledLabel")} hint={t("modal.enabledHint")}>
                <Toggle
                  on={enabled}
                  onChange={setEnabled}
                  ariaLabel={t("modal.enabledAria")}
                />
              </FormField>
            </div>

            <FormField label={t("modal.bodyLabel")} required htmlFor="conv-skill-body">
              <MarkdownEditor
                id="conv-skill-body"
                name={trimmedName}
                value={body}
                onChange={setBody}
                dirty={seededFrom !== null && body !== seededFrom}
              />
            </FormField>
          </div>
        )}
      </div>
    </Modal>
  );
}
