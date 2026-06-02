"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Modal, FormField, TextInput, SelectInput, Textarea } from "@devdigest/ui";
import type { Provider } from "@devdigest/shared";
import { useCreateAgent } from "../../../../../../lib/hooks/agents";
import { DEFAULT_MODEL, DEFAULT_PROVIDER, MODAL_WIDTH, PROVIDER_OPTIONS } from "./constants";
import { s } from "./styles";

/** Create-agent modal — name/description/provider/model/system-prompt. */
export function CreateAgentModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("agents");
  const router = useRouter();
  const create = useCreateAgent();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [provider, setProvider] = React.useState<Provider>(DEFAULT_PROVIDER);
  const [model, setModel] = React.useState(DEFAULT_MODEL);
  const [systemPrompt, setSystemPrompt] = React.useState(t("create.defaultSystemPrompt"));

  const submit = async () => {
    const agent = await create.mutateAsync({
      name: name.trim() || t("create.defaultName"),
      description,
      provider,
      model,
      system_prompt: systemPrompt,
    });
    onClose();
    router.push(`/agents/${agent.id}?tab=config`);
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
          <Button kind="primary" icon="Plus" onClick={submit} disabled={create.isPending}>
            {create.isPending ? t("create.creating") : t("create.create")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
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
        <FormField label={t("create.fields.provider")}>
          <SelectInput
            value={provider}
            onChange={(v) => setProvider(v as Provider)}
            options={[...PROVIDER_OPTIONS]}
          />
        </FormField>
        <FormField label={t("create.fields.model")}>
          <TextInput value={model} onChange={setModel} mono />
        </FormField>
        <FormField label={t("create.fields.systemPrompt")}>
          <Textarea value={systemPrompt} onChange={setSystemPrompt} rows={6} mono />
        </FormField>
      </div>
    </Modal>
  );
}
