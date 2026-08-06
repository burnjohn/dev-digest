/* GitHubTokenPicker — choose which saved PAT a repo authenticates with, with
   inline creation so first-run never has to detour through Settings. Used by
   AddRepoView and RepoSettingsView; the two must not diverge. Presentational
   + data-fetching only: it never assigns a token to a repo or adds a repo
   itself — callers wire `onChange` to whatever mutation does that. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Dropdown, TextInput, Icon, type DropdownItemDef } from "@devdigest/ui";
import { useCreateGitHubToken, useGitHubTokens, useTestGitHubToken } from "@/lib/hooks";
import { ApiError } from "@/lib/api";

export function GitHubTokenPicker({
  value,
  onChange,
  fullName,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  /** `owner/name` — when present, Test also proves access to that repo. */
  fullName?: string;
}) {
  const t = useTranslations("github-tokens");
  const { data: tokens } = useGitHubTokens();
  const create = useCreateGitHubToken();
  const test = useTestGitHubToken();

  const [creating, setCreating] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [token, setToken] = React.useState("");
  const [result, setResult] = React.useState<{ ok: boolean; message: string } | null>(null);

  const selected = tokens?.find((tk) => tk.id === value) ?? null;

  const items: DropdownItemDef[] = [
    ...(tokens ?? []).map((tk) => ({
      label: tk.label,
      icon: "Lock" as const,
      onClick: () => onChange(tk.id),
    })),
    ...(tokens && tokens.length ? [{ divider: true }] : []),
    {
      label: t("picker.newToken"),
      icon: "Plus" as const,
      muted: true,
      onClick: () => {
        setResult(null);
        setCreating(true);
      },
    },
  ];

  const runTest = async () => {
    setResult(null);
    try {
      const r = await test.mutateAsync({
        token: token.trim(),
        ...(fullName ? { full_name: fullName } : {}),
      });
      setResult({ ok: r.ok, message: r.message });
    } catch (e) {
      setResult({ ok: false, message: e instanceof ApiError ? e.message : t("picker.testFailed") });
    }
  };

  const save = async () => {
    setResult(null);
    try {
      const created = await create.mutateAsync({ label: label.trim(), token: token.trim() });
      onChange(created.id);
      setCreating(false);
      setLabel("");
      setToken("");
    } catch (e) {
      setResult({ ok: false, message: e instanceof ApiError ? e.message : t("picker.saveFailed") });
    }
  };

  return (
    <div>
      <Dropdown
        align="left"
        width={240}
        items={items}
        trigger={
          <Button kind="secondary" size="md">
            {selected ? selected.label : t("picker.placeholder")}
            <Icon.ChevronsUpDown size={13} />
          </Button>
        }
      />

      {creating && (
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <TextInput value={label} onChange={setLabel} placeholder={t("picker.labelPlaceholder")} />
          <TextInput
            value={token}
            onChange={setToken}
            mono
            type="password"
            placeholder={t("picker.tokenPlaceholder")}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              kind="secondary"
              size="md"
              onClick={runTest}
              disabled={!token.trim() || test.isPending}
            >
              {test.isPending ? t("picker.testing") : t("picker.test")}
            </Button>
            <Button
              kind="primary"
              size="md"
              onClick={save}
              disabled={!label.trim() || !token.trim() || create.isPending}
            >
              {create.isPending ? t("picker.saving") : t("picker.save")}
            </Button>
            <Button kind="ghost" size="md" onClick={() => setCreating(false)}>
              {t("picker.cancel")}
            </Button>
          </div>
        </div>
      )}

      {result && (
        <div
          style={{
            marginTop: 8,
            fontSize: 12,
            color: result.ok ? "var(--ok)" : "var(--crit)",
          }}
        >
          {result.message}
        </div>
      )}
    </div>
  );
}
