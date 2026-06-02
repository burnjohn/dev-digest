"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, TextInput, FormField } from "@devdigest/ui";
import { useImportSkill } from "../../../../../../lib/hooks/skills";
import { ApiError } from "../../../../../../lib/api";
import { ImportResult } from "../ImportResult";
import { URL_CLOSE_DELAY_MS } from "../../constants";

export function UrlPanel({ onDone }: { onDone: () => void }) {
  const t = useTranslations("skills");
  const [url, setUrl] = React.useState("");
  const imp = useImportSkill();
  const [res, setRes] = React.useState<{ ok: boolean; message: string } | null>(null);

  const run = async () => {
    setRes(null);
    try {
      const skill = await imp.mutateAsync({ url });
      setRes({ ok: true, message: t("url.success", { name: skill.name }) });
      setTimeout(onDone, URL_CLOSE_DELAY_MS);
    } catch (e) {
      setRes({ ok: false, message: e instanceof ApiError ? e.message : t("drawer.importFailed") });
    }
  };

  return (
    <>
      <FormField label={t("url.label")} hint={t("url.hint")}>
        <TextInput value={url} onChange={setUrl} placeholder={t("url.placeholder")} mono />
      </FormField>
      <Button kind="primary" icon="Link" full onClick={run} disabled={!url.trim() || imp.isPending}>
        {imp.isPending ? t("url.fetching") : t("url.import")}
      </Button>
      {res && <ImportResult {...res} />}
    </>
  );
}
