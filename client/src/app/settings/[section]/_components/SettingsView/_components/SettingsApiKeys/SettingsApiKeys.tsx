"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, FormField, TextInput } from "@devdigest/ui";
import { useTestConnection, useSecretsStatus } from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import type { ConnTestProvider } from "@/lib/types";
import { SectionTitle } from "../SectionTitle";
import { KEY_ROWS } from "./constants";
import { s } from "./styles";

/** "Configured / Not set" pill driven by GET /settings/secrets-status. */
function StatusBadge({ configured }: { configured: boolean | undefined }) {
  const t = useTranslations("settings");
  if (configured === undefined) return null; // status still loading
  return (
    <span style={s.badge(configured)}>
      <span style={s.badgeDot(configured)} />
      {configured ? t("apiKeys.configured") : t("apiKeys.notSet")}
    </span>
  );
}

function KeyRow({
  label,
  provider,
  hint,
  configured,
}: {
  label: string;
  provider: ConnTestProvider;
  hint: string;
  configured: boolean | undefined;
}) {
  const t = useTranslations("settings");
  const [val, setVal] = React.useState("");
  const [reveal, setReveal] = React.useState(false);
  const test = useTestConnection();
  const [res, setRes] = React.useState<{ ok: boolean; message: string } | null>(null);

  const run = async () => {
    setRes(null);
    try {
      const r = await test.mutateAsync({ provider, key: val.trim() || undefined });
      setRes({ ok: r.ok, message: r.message });
    } catch (e) {
      setRes({ ok: false, message: e instanceof ApiError ? e.message : t("apiKeys.testFailed") });
    }
  };

  return (
    <FormField label={label} hint={hint} right={<StatusBadge configured={configured} />}>
      <div style={s.keyRow}>
        <div style={s.keyInput}>
          <TextInput
            value={val}
            onChange={setVal}
            mono
            type={reveal ? "text" : "password"}
            placeholder={t("apiKeys.placeholder")}
            suffix={
              <Icon.EyeOff size={14} style={s.revealIcon} onClick={() => setReveal((r) => !r)} />
            }
          />
        </div>
        <Button kind="secondary" size="md" onClick={run} disabled={test.isPending}>
          {test.isPending ? t("apiKeys.testing") : t("apiKeys.testConnection")}
        </Button>
      </div>
      {res && (
        <div style={s.result(res.ok)}>
          {res.ok ? <Icon.CheckCircle size={13} /> : <Icon.XCircle size={13} />}
          {res.message}
        </div>
      )}
    </FormField>
  );
}

export function SettingsApiKeys() {
  const t = useTranslations("settings");
  const { data: status } = useSecretsStatus();
  return (
    <div style={s.wrap}>
      <SectionTitle title={t("apiKeys.title")} body={t("apiKeys.body")} />
      {KEY_ROWS.map((row) => (
        <KeyRow
          key={row.provider}
          label={t(row.labelKey)}
          provider={row.provider}
          hint={t(row.hintKey)}
          configured={status?.[row.provider]}
        />
      ))}
    </div>
  );
}
