/* /repos/:repoId/conventions — scan a cloned repo for house conventions,
   accept/reject/edit each candidate, then bundle the accepted ones into a
   skill. See specs/03-conventions.md. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useConventions, useExtractConventions, useUpdateConvention } from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import { CandidateCard } from "./CandidateCard";
import { CreateSkillModal } from "./CreateSkillModal";
import { s } from "./styles";

export function ConventionsView({ repoId }: { repoId: string }) {
  const t = useTranslations("conventions");
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const repoName = activeRepo?.full_name?.split("/").pop() ?? t("page.repoFallback");

  const { data: scan, isLoading, isError, refetch } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const update = useUpdateConvention(repoId);

  // Which currently-ACCEPTED candidates are opted OUT of the next "Create
  // skill" bundle. Separate from the accept/reject decision itself — see the
  // module doc comment on ConventionsView for why.
  const [deselected, setDeselected] = React.useState<Set<string>>(new Set());
  const [showCreateModal, setShowCreateModal] = React.useState(false);

  const candidates = scan?.candidates ?? [];
  const accepted = candidates.filter((c) => c.accepted);
  const bundle = accepted.filter((c) => !deselected.has(c.id));

  if (repoNotFound) {
    return (
      <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }]}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }]}>
      {showCreateModal && (
        <CreateSkillModal
          candidates={bundle}
          repoFullName={activeRepo?.full_name}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => setDeselected(new Set(accepted.map((c) => c.id)))}
        />
      )}

      <div style={s.page}>
        <div style={s.header}>
          <div>
            <h1 style={s.h1}>
              {t("page.headingPrefix")}
              <span style={s.repoName}>{repoName}</span>
            </h1>
            <p style={s.subtitle}>{t("page.subtitle")}</p>
          </div>
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            loading={extract.isPending}
            onClick={() => extract.mutate()}
          >
            {extract.isPending ? t("page.scanning") : scan && candidates.length > 0 ? t("page.rescan") : t("page.runExtraction")}
          </Button>
        </div>

        {extract.isError && (
          <ErrorState
            title={t("page.extractionFailed")}
            body={extract.error instanceof ApiError ? extract.error.message : undefined}
          />
        )}

        {isLoading && (
          <div style={s.loadingList}>
            <Skeleton height={140} />
            <Skeleton height={140} />
          </div>
        )}

        {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}

        {!isLoading && !isError && candidates.length === 0 && (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={() => extract.mutate()}
          />
        )}

        {!isLoading && !isError && candidates.length > 0 && (
          <>
            <p style={s.subtitle}>{t("page.candidateCount", { count: candidates.length })}</p>

            {accepted.length > 0 && (
              <div style={s.toolbar}>
                <Button
                  kind="ghost"
                  size="sm"
                  onClick={() => setDeselected(new Set(accepted.map((c) => c.id)))}
                >
                  {t("toolbar.deselectAll")}
                </Button>
                <span style={s.toolbarCount}>
                  {t("toolbar.selectedCount", { selected: bundle.length, total: accepted.length })}
                </span>
                <div style={s.toolbarSpacer} />
                <Button
                  kind="primary"
                  size="sm"
                  icon="Sparkles"
                  disabled={bundle.length === 0}
                  onClick={() => setShowCreateModal(true)}
                >
                  {t("toolbar.createSkill")}
                </Button>
              </div>
            )}

            <div style={s.list}>
              {candidates.map((candidate) => (
                <CandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  bundleSelected={!deselected.has(candidate.id)}
                  onToggleBundleSelected={(v) =>
                    setDeselected((prev) => {
                      const next = new Set(prev);
                      if (v) next.delete(candidate.id);
                      else next.add(candidate.id);
                      return next;
                    })
                  }
                  onAccept={() => update.mutate({ id: candidate.id, patch: { accepted: true } })}
                  onReject={() => update.mutate({ id: candidate.id, patch: { accepted: false } })}
                  onSaveEdit={(patch) => update.mutate({ id: candidate.id, patch })}
                  saving={update.isPending && update.variables?.id === candidate.id}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
