"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Icon, TextInput, Button, Skeleton } from "@devdigest/ui";
import { useContextFolders, useSetContextFolders } from "@/lib/hooks/context-docs";
import { s } from "../../styles";

interface Props {
  repoId: string;
}

/** Root-folder-name chip editor (AC-21) — add/remove folder names, persist via
    useSetContextFolders. Defaults shown are specs/docs/insights when the API
    returns the default set (repos.context_folders is null server-side). */
export function FoldersConfig({ repoId }: Props) {
  const t = useTranslations("context");
  const { data, isLoading } = useContextFolders(repoId);
  const setFolders = useSetContextFolders(repoId);
  const [draft, setDraft] = useState("");

  const folders = data?.folders ?? [];

  const handleAdd = () => {
    const trimmed = draft.trim();
    if (!trimmed || folders.includes(trimmed)) return;
    setFolders.mutate([...folders, trimmed]);
    setDraft("");
  };

  const handleRemove = (folder: string) => {
    setFolders.mutate(folders.filter((f) => f !== folder));
  };

  return (
    <div style={s.foldersSection}>
      <div style={s.foldersHeader}>
        <Icon.Folder size={14} />
        {t("folders.title")}
      </div>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)" }}>{t("folders.hint")}</p>

      {isLoading ? (
        <Skeleton height={28} width={280} />
      ) : (
        <div style={s.foldersChipRow}>
          {folders.map((folder) => (
            <span key={folder} style={s.folderChip}>
              {folder}
              <button
                type="button"
                aria-label={t("folders.remove", { folder })}
                onClick={() => handleRemove(folder)}
                disabled={setFolders.isPending}
                style={s.folderChipRemove}
              >
                <Icon.X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div style={s.addFolderRow}>
        <div style={s.addFolderInput}>
          <TextInput
            value={draft}
            onChange={setDraft}
            placeholder={t("folders.addPlaceholder")}
            mono
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
          />
        </div>
        <Button kind="secondary" size="sm" icon="Plus" onClick={handleAdd} disabled={!draft.trim() || setFolders.isPending}>
          {t("folders.add")}
        </Button>
      </div>
    </div>
  );
}
