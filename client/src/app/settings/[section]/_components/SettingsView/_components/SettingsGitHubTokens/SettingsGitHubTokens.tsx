"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, TextInput, Icon } from "@devdigest/ui";
import type { GitHubToken } from "@devdigest/shared";
import {
  useGitHubTokens,
  useCreateGitHubToken,
  usePatchGitHubToken,
  useDeleteGitHubToken,
} from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import { SectionTitle } from "../SectionTitle";
import { s } from "./styles";

/** One saved token — view mode plus inline rename/replace/delete-confirm. */
function TokenRow({ token }: { token: GitHubToken }) {
  const t = useTranslations("github-tokens");
  const c = useTranslations("common");
  const patch = usePatchGitHubToken();
  const del = useDeleteGitHubToken();

  const [mode, setMode] = React.useState<"view" | "rename" | "replace" | "delete">("view");
  const [label, setLabel] = React.useState(token.label);
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const reset = () => {
    setMode("view");
    setLabel(token.label);
    setValue("");
    setError(null);
  };

  const saveRename = async () => {
    setError(null);
    try {
      await patch.mutateAsync({ id: token.id, label: label.trim() });
      setMode("view");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("picker.saveFailed"));
    }
  };

  const saveReplace = async () => {
    setError(null);
    try {
      await patch.mutateAsync({ id: token.id, token: value.trim() });
      setMode("view");
      setValue("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("picker.saveFailed"));
    }
  };

  if (mode === "rename") {
    return (
      <div style={s.row}>
        <div style={s.inlineForm}>
          <TextInput value={label} onChange={setLabel} placeholder={t("picker.labelPlaceholder")} />
        </div>
        <div style={s.rowActions}>
          <Button kind="primary" size="sm" onClick={saveRename} disabled={!label.trim() || patch.isPending}>
            {c("actions.save")}
          </Button>
          <Button kind="ghost" size="sm" onClick={reset}>
            {c("actions.cancel")}
          </Button>
        </div>
        {error && <div style={s.result(false)}>{error}</div>}
      </div>
    );
  }

  if (mode === "replace") {
    return (
      <div style={s.row}>
        <div style={s.inlineForm}>
          <TextInput
            value={value}
            onChange={setValue}
            mono
            type="password"
            placeholder={t("picker.tokenPlaceholder")}
          />
        </div>
        <div style={s.rowActions}>
          <Button kind="primary" size="sm" onClick={saveReplace} disabled={!value.trim() || patch.isPending}>
            {c("actions.save")}
          </Button>
          <Button kind="ghost" size="sm" onClick={reset}>
            {c("actions.cancel")}
          </Button>
        </div>
        {error && <div style={s.result(false)}>{error}</div>}
      </div>
    );
  }

  if (mode === "delete") {
    return (
      <div style={s.row}>
        <div style={s.confirmBar}>
          <Icon.AlertTriangle size={14} style={{ flexShrink: 0 }} />
          {token.repo_count > 0
            ? t("settings.deleteOrphanWarning", { count: token.repo_count })
            : null}
        </div>
        <div style={s.rowActions}>
          <Button kind="danger" size="sm" onClick={() => del.mutate(token.id)} disabled={del.isPending}>
            {t("settings.delete")}
          </Button>
          <Button kind="ghost" size="sm" onClick={reset}>
            {c("actions.cancel")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.row}>
      <div style={s.rowMain}>
        <div style={s.rowLabel}>
          <Icon.Lock size={13} style={{ color: "var(--text-muted)" }} />
          <strong>{token.label}</strong>
          {token.github_login && <span style={{ color: "var(--text-muted)" }}>@{token.github_login}</span>}
        </div>
        <div style={s.rowMeta}>
          {t("settings.repoCount", { count: token.repo_count })}
          {!token.configured && (
            <>
              {" · "}
              <span style={s.notConfigured}>{t("settings.notConfigured")}</span>
            </>
          )}
        </div>
      </div>
      <div style={s.rowActions}>
        <Button kind="tertiary" size="sm" onClick={() => setMode("rename")}>
          {t("settings.rename")}
        </Button>
        <Button kind="tertiary" size="sm" onClick={() => setMode("replace")}>
          {t("settings.replace")}
        </Button>
        <Button kind="danger" size="sm" onClick={() => setMode("delete")}>
          {t("settings.delete")}
        </Button>
      </div>
    </div>
  );
}

/** Inline "+ Add token" form. Presentational — validation/error surfacing is
    the server's, this only calls useCreateGitHubToken and shows its result. */
function CreateTokenForm() {
  const t = useTranslations("github-tokens");
  const c = useTranslations("common");
  const create = useCreateGitHubToken();
  const [open, setOpen] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [token, setToken] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const reset = () => {
    setOpen(false);
    setLabel("");
    setToken("");
    setError(null);
  };

  const save = async () => {
    setError(null);
    try {
      await create.mutateAsync({ label: label.trim(), token: token.trim() });
      reset();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("picker.saveFailed"));
    }
  };

  if (!open) {
    return (
      <Button kind="secondary" size="md" icon="Plus" onClick={() => setOpen(true)}>
        {t("picker.newToken")}
      </Button>
    );
  }

  return (
    <div style={s.createSection}>
      <TextInput value={label} onChange={setLabel} placeholder={t("picker.labelPlaceholder")} />
      <TextInput
        value={token}
        onChange={setToken}
        mono
        type="password"
        placeholder={t("picker.tokenPlaceholder")}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <Button kind="primary" size="md" onClick={save} disabled={!label.trim() || !token.trim() || create.isPending}>
          {create.isPending ? t("picker.saving") : t("picker.save")}
        </Button>
        <Button kind="ghost" size="md" onClick={reset}>
          {c("actions.cancel")}
        </Button>
      </div>
      {error && <div style={s.result(false)}>{error}</div>}
    </div>
  );
}

export function SettingsGitHubTokens() {
  const t = useTranslations("github-tokens");
  const { data: tokens } = useGitHubTokens();

  return (
    <div style={s.wrap}>
      <SectionTitle title={t("settings.title")} body={t("settings.body")} />
      <div style={s.list}>
        {(tokens ?? []).map((tk) => (
          <TokenRow key={tk.id} token={tk} />
        ))}
      </div>
      <div style={{ marginTop: 16 }}>
        <CreateTokenForm />
      </div>
    </div>
  );
}
