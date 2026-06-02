"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, TextInput, Textarea, FormField } from "@devdigest/ui";
import { useImportSkill } from "../../../../../../lib/hooks/skills";
import { ApiError } from "../../../../../../lib/api";
import { ImportResult } from "../ImportResult";
import { FILE_CLOSE_DELAY_MS } from "../../constants";

export function FilePanel({ onDone }: { onDone: () => void }) {
  const t = useTranslations("skills");
  const [name, setName] = React.useState("");
  const [body, setBody] = React.useState("");
  const imp = useImportSkill();
  const [res, setRes] = React.useState<{ ok: boolean; message: string } | null>(null);

  const run = async () => {
    setRes(null);
    try {
      const skill = await imp.mutateAsync({ body, name: name || undefined });
      setRes({ ok: true, message: t("file.success", { name: skill.name }) });
      setTimeout(onDone, FILE_CLOSE_DELAY_MS);
    } catch (e) {
      setRes({ ok: false, message: e instanceof ApiError ? e.message : t("drawer.importFailed") });
    }
  };

  return (
    <>
      <FormField label={t("file.nameLabel")} hint={t("file.nameHint")}>
        <TextInput value={name} onChange={setName} placeholder={t("file.namePlaceholder")} mono />
      </FormField>
      <FormField label={t("file.bodyLabel")} hint={t("file.bodyHint")}>
        <Textarea value={body} onChange={setBody} rows={10} mono placeholder={t("file.bodyPlaceholder")} />
      </FormField>
      <Button kind="primary" icon="Upload" full onClick={run} disabled={!body.trim() || imp.isPending}>
        {imp.isPending ? t("file.importing") : t("file.import")}
      </Button>
      {res && <ImportResult {...res} />}
    </>
  );
}
