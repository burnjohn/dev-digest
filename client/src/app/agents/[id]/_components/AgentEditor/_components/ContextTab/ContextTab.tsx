"use client";

/* ContextTab — Agent Editor "Context" tab. Attaches Project Context markdown
   documents (by path only, never text) to an agent, in prompt-injection
   order. Agents are workspace-level (no owning repo) — per
   docs/plans/2026-07-02-project-context-folder.md §4 "Attachment scoping
   model", the picker uses an EXPLICIT, deterministic, user-visible selected
   repository (the same shell-level active-repo state used elsewhere in the
   app), and surfaces which repo is being browsed. Only the repo-relative
   path is persisted; it is re-resolved against the PR's own repo at run time. */

import React from "react";
import { useTranslations } from "next-intl";
import type { Agent } from "@devdigest/shared";
import { useActiveRepo } from "@/lib/repo-context";
import { useContextDocs, useAgentContextDocs, useSetAgentContextDocs } from "@/lib/hooks/context-docs";
import { ContextDocsList } from "./_components/ContextDocsList";
import { s } from "./styles";

interface ContextTabProps {
  agent: Agent;
}

export function ContextTab({ agent }: ContextTabProps) {
  const t = useTranslations("agents.context");
  const { repoId, activeRepo, repos, reposLoaded } = useActiveRepo();

  const { data: docs, isLoading: loadingDocs } = useContextDocs(repoId);
  const { data: linkedLinks, isLoading: loadingLinked } = useAgentContextDocs(agent.id);
  const setContextDocs = useSetAgentContextDocs(agent.id);

  const linkedPaths: string[] = (linkedLinks ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((l) => l.path);

  const repoLabel = activeRepo?.full_name ?? (reposLoaded && repos.length === 0 ? t("noRepo") : "…");

  return (
    <div style={s.wrap}>
      <ContextDocsList
        t={t}
        repoId={repoId}
        repoLabel={repoLabel}
        docs={docs}
        isLoadingDocs={loadingDocs}
        linkedPaths={linkedPaths}
        isLoadingLinked={loadingLinked}
        onSetLinked={(paths) => setContextDocs.mutate(paths)}
        isSaving={setContextDocs.isPending}
      />
    </div>
  );
}
