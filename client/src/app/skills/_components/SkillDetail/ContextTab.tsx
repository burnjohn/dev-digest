"use client";

/* SkillDetail ContextTab — dedicated "Context" tab for the skill editor (AC-35),
   matching the agent editor's Context tab and the design mock's tab row. Hosts
   the shared ContextDocsList; wiring moved here verbatim from ConfigTab's old
   embedded "Project context to use" section. Skills are workspace-level (no
   owning repo) — the picker browses the explicit, user-visible active repo and
   persists only the repo-relative path. */

import React from "react";
import { useTranslations } from "next-intl";
import type { Skill } from "@devdigest/shared";
import { useActiveRepo } from "@/lib/repo-context";
import { useContextDocs, useSkillContextDocs, useSetSkillContextDocs } from "@/lib/hooks/context-docs";
import { ContextDocsList } from "@/app/agents/[id]/_components/AgentEditor/_components/ContextTab/_components/ContextDocsList";

interface ContextTabProps {
  skill: Skill;
}

export function ContextTab({ skill }: ContextTabProps) {
  const t = useTranslations("skills.contextDocs");
  const { repoId, activeRepo, repos, reposLoaded } = useActiveRepo();

  const { data: docs, isLoading: loadingDocs } = useContextDocs(repoId);
  const { data: linkedLinks, isLoading: loadingLinked } = useSkillContextDocs(skill.id);
  const setContextDocs = useSetSkillContextDocs(skill.id);

  const linkedPaths: string[] = (linkedLinks ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((l) => l.path);

  const repoLabel = activeRepo?.full_name ?? (reposLoaded && repos.length === 0 ? t("noRepo") : "…");

  return (
    <div style={{ padding: "24px 28px", maxWidth: 800 }}>
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
