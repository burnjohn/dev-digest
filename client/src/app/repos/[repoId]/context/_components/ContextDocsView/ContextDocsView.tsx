"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useContextDocs } from "@/lib/hooks/context-docs";
import { DocList } from "./_components/DocList";
import { DocDetail } from "./_components/DocDetail";
import { FoldersConfig } from "./_components/FoldersConfig";
import { s } from "./styles";

interface Props {
  repoId: string;
}

/** Two-panel master-detail Project Context page (AC-22): DocList (left) +
    DocDetail (right, inline preview/edit). Selecting a row updates the detail
    panel without navigation. The `+`/upload toolbar creates overlay-only docs
    (AC-27/AC-32); all mutations auto-refresh the list via React Query (AC-33). */
export function ContextDocsView({ repoId }: Props) {
  const t = useTranslations("context");
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const { data: docs, isLoading, isError, refetch } = useContextDocs(repoId);

  const [filter, setFilter] = useState("");
  // `null` = nothing selected; `""` = an unsaved new document (create/upload).
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [seed, setSeed] = useState<{ path: string; body: string } | undefined>(undefined);

  const crumb = [{ label: activeRepo?.full_name ?? "Repo" }, { label: t("title") }];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const list = docs ?? [];
  const filtered = list.filter((d) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return d.path.toLowerCase().includes(q) || d.category.toLowerCase().includes(q);
  });

  const selectExisting = (path: string) => {
    setSeed(undefined);
    setSelectedPath(path);
  };

  const startNew = (initial: { path: string; body: string }) => {
    setSeed(initial);
    setSelectedPath("");
  };

  const handleUpload = async (file: File) => {
    const text = await file.text();
    startNew({ path: `docs/${file.name}`, body: text });
  };

  const handleSaved = (path: string) => {
    setSeed(undefined);
    setSelectedPath(path);
  };

  const handleDeleted = () => {
    setSeed(undefined);
    setSelectedPath(null);
  };

  const selectedDoc =
    selectedPath && selectedPath !== "" ? list.find((d) => d.path === selectedPath) : undefined;

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.headerRow}>
          <div>
            <h1 style={s.title}>{t("title")}</h1>
            <p style={s.subtitle}>{t("subtitle")}</p>
          </div>
        </div>

        <FoldersConfig repoId={repoId} />

        {isError ? (
          <ErrorState onRetry={() => refetch()} body={t("loadError")} />
        ) : !isLoading && list.length === 0 ? (
          <EmptyState icon="FileText" title={t("empty.title")} body={t("empty.body")} />
        ) : (
          <div style={s.twoPanel}>
            <DocList
              t={t}
              docs={filtered}
              filter={filter}
              onFilter={setFilter}
              selectedPath={selectedPath}
              onSelect={selectExisting}
              onNew={() => startNew({ path: "", body: "" })}
              onUpload={handleUpload}
              onRefresh={() => refetch()}
              isLoading={isLoading}
            />

            {selectedPath !== null ? (
              <DocDetail
                key={selectedPath}
                t={t}
                repoId={repoId}
                selectedPath={selectedPath}
                doc={selectedDoc}
                seed={seed}
                onSaved={handleSaved}
                onDeleted={handleDeleted}
              />
            ) : (
              <div style={s.detailPanel}>
                <div style={s.detailEmpty}>{t("detail.empty")}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
