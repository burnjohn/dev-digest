"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FormField, TextInput, SelectInput, Textarea, Toggle, Button } from "@devdigest/ui";
import type { Agent, Provider } from "@devdigest/shared";
import { useUpdateAgent, useProviderModels } from "../../../../../../../lib/hooks/agents";
import { OUTPUT_SCHEMA_VALUE, PROVIDER_OPTIONS } from "./constants";
import { s } from "./styles";

/** Config tab — name/description/provider/model/system-prompt + enabled toggle. */
export function ConfigTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const update = useUpdateAgent();
  const [name, setName] = React.useState(agent.name);
  const [description, setDescription] = React.useState(agent.description);
  const [provider, setProvider] = React.useState<Provider>(agent.provider);
  const [model, setModel] = React.useState(agent.model);
  const [systemPrompt, setSystemPrompt] = React.useState(agent.system_prompt);
  const [enabled, setEnabled] = React.useState(agent.enabled);

  // Reset local form when switching agents.
  React.useEffect(() => {
    setName(agent.name);
    setDescription(agent.description);
    setProvider(agent.provider);
    setModel(agent.model);
    setSystemPrompt(agent.system_prompt);
    setEnabled(agent.enabled);
  }, [agent.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: models } = useProviderModels(provider);
  const modelOptions = (models ?? []).map((m) => m.id);
  if (!modelOptions.includes(model)) modelOptions.unshift(model);

  const save = () =>
    update.mutate({
      id: agent.id,
      patch: { name, description, provider, model, system_prompt: systemPrompt, enabled },
    });

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("config.title")}</h2>
        <label style={s.enabledLabel}>
          {t("config.enabled")}
          <Toggle on={enabled} onChange={setEnabled} size={16} />
        </label>
      </div>
      <FormField label={t("config.name")} required>
        <TextInput value={name} onChange={setName} />
      </FormField>
      <FormField label={t("config.description")}>
        <TextInput value={description} onChange={setDescription} />
      </FormField>
      <FormField label={t("config.provider")}>
        <SelectInput
          value={provider}
          onChange={(v) => setProvider(v as Provider)}
          options={[...PROVIDER_OPTIONS]}
        />
      </FormField>
      <FormField label={t("config.model")} hint={t("config.modelHint")}>
        <SelectInput value={model} onChange={setModel} options={modelOptions} />
      </FormField>
      <FormField label={t("config.systemPrompt")} hint={t("config.systemPromptHint")}>
        <Textarea value={systemPrompt} onChange={setSystemPrompt} rows={8} mono />
      </FormField>
      <FormField label={t("config.outputSchema")}>
        <SelectInput value={OUTPUT_SCHEMA_VALUE} options={[OUTPUT_SCHEMA_VALUE]} />
      </FormField>
      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={save} disabled={update.isPending}>
          {update.isPending ? t("config.saving") : t("config.save")}
        </Button>
        {update.isSuccess && (
          <span style={s.savedNote}>{t("config.saved", { version: update.data?.version })}</span>
        )}
      </div>
    </div>
  );
}
