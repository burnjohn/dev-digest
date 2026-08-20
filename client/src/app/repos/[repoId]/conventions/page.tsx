/* Route: /repos/:repoId/conventions — the Conventions Extractor.
   Scan the cloned repo for house-rules, triage the candidates, and merge the
   accepted ones into a skill. Every candidate on this page has already passed
   the server's evidence gate, so the snippets shown are real repo bytes. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Chip, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { ConventionExtractResult, ConventionSkillDraft } from "@devdigest/shared";
import { AppShell } from "../../../../components/app-shell";
import { RepoNotFound } from "../../../../components/repo-not-found";
import {
  useConventionSkillDraft,
  useConventions,
  useDeleteConvention,
  useExtractConventions,
  useUpdateConvention,
} from "../../../../lib/hooks";
import { useActiveRepo, useRepoNotFound } from "../../../../lib/repo-context";
import { useToast } from "../../../../lib/toast";
import { ConventionCard } from "./_components/ConventionCard";
import { CreateSkillModal } from "./_components/CreateSkillModal";
import { FILTERS, SKELETON_CARDS, type ConventionFilter } from "./constants";
import { countByStatus, filterCandidates, githubEvidenceUrl } from "./helpers";
import { s } from "./styles";

export default function ConventionsPage() {
  const t = useTranslations("conventions");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const toast = useToast();

  const { data: candidates, isLoading, isError, refetch } = useConventions(repoId);
  const extract = useExtractConventions();
  const update = useUpdateConvention();
  const remove = useDeleteConvention();
  const draftSkill = useConventionSkillDraft();

  const [filter, setFilter] = React.useState<ConventionFilter>("pending");
  const [scan, setScan] = React.useState<ConventionExtractResult | null>(null);
  const [draft, setDraft] = React.useState<ConventionSkillDraft | undefined>();
  const [modalOpen, setModalOpen] = React.useState(false);
  /**
   * Which accepted candidates go into the NEXT skill. Empty means "all of them",
   * so the common case needs no clicks; deselecting is how you split one board
   * into several focused skills.
   */
  const [excluded, setExcluded] = React.useState<Set<string>>(new Set());

  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }];
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const repoName = activeRepo?.full_name ?? t("page.repoFallback");
  const all = candidates ?? [];
  const counts = countByStatus(all);
  const visible = filterCandidates(all, filter);
  const scanned = all.length > 0;

  const runScan = async () => {
    try {
      const result = await extract.mutateAsync(repoId);
      setScan(result);
      // Land on the state that has something in it: a first scan produces only
      // pending rows, a re-scan may produce none at all.
      setFilter(result.candidates.some((c) => c.status === "pending") ? "pending" : "all");
    } catch {
      toast.error(t("page.extractionFailed"));
    }
  };

  const acceptedIds = all.filter((c) => c.status === "accepted").map((c) => c.id);
  const selectedIds = acceptedIds.filter((id) => !excluded.has(id));

  const openSkillModal = async () => {
    setDraft(undefined);
    setModalOpen(true);
    try {
      setDraft(await draftSkill.mutateAsync({ repoId, conventionIds: selectedIds }));
    } catch {
      setModalOpen(false);
      toast.error(t("modal.failed"));
    }
  };

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        {modalOpen && (
          <CreateSkillModal
            repoName={repoName}
            acceptedCount={selectedIds.length}
            draft={draft}
            onClose={() => setModalOpen(false)}
          />
        )}

        <div style={s.headerRow}>
          <h1 style={s.heading}>
            {t("page.headingPrefix")}
            <span className="mono" style={s.repoName}>
              {repoName}
            </span>
          </h1>
          <Button
            icon="RefreshCw"
            onClick={runScan}
            loading={extract.isPending}
            disabled={extract.isPending}
          >
            {extract.isPending
              ? t("page.scanning")
              : scanned
                ? t("page.rescan")
                : t("page.runExtraction")}
          </Button>
        </div>
        <p style={s.subtitle}>{t("page.subtitle")}</p>

        {scan && (
          <p style={s.scanSummary}>
            {t("page.scanSummary", {
              sampled: scan.sampled_files.length,
              model: scan.model,
              proposed: scan.proposed,
              droppedUngrounded: scan.dropped_ungrounded,
              droppedDuplicate: scan.dropped_duplicate,
            })}
          </p>
        )}

        {scanned && (
          <div style={s.toolbar}>
            {FILTERS.map((f) => (
              <Chip key={f} active={filter === f} count={counts[f]} onClick={() => setFilter(f)}>
                {t(`page.filter.${f}`)}
              </Chip>
            ))}
            <div style={s.toolbarSpacer} />
            {counts.accepted > 0 && (
              <>
                <Button
                  kind="ghost"
                  size="sm"
                  icon="X"
                  onClick={() =>
                    setExcluded(excluded.size === 0 ? new Set(acceptedIds) : new Set())
                  }
                >
                  {excluded.size === 0 ? t("page.deselectAll") : t("page.selectAll")}
                </Button>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {t("page.selectedCount", {
                    selected: selectedIds.length,
                    total: counts.accepted,
                  })}
                </span>
              </>
            )}
            <Button
              kind="primary"
              icon="Sparkles"
              disabled={selectedIds.length === 0 || draftSkill.isPending}
              onClick={openSkillModal}
            >
              {t("page.createSkill")}
            </Button>
          </div>
        )}

        {isLoading && (
          <div style={s.list}>
            {Array.from({ length: SKELETON_CARDS }, (_, i) => (
              <Skeleton key={i} height={180} />
            ))}
          </div>
        )}

        {isError && <ErrorState title={t("page.loadError")} onRetry={() => refetch()} />}

        {!isLoading && !isError && !scanned && (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={runScan}
          />
        )}

        {!isLoading && !isError && scanned && visible.length === 0 && (
          <EmptyState
            icon="ListChecks"
            title={t("page.emptyFiltered.title")}
            body={t("page.emptyFiltered.body")}
          />
        )}

        {visible.length > 0 && (
          <>
            <p style={s.scanSummary}>
              <Icon.Check size={12} style={{ verticalAlign: "-1px", marginRight: 6 }} />
              {t("page.candidateCount", { count: visible.length })}
            </p>
            <div style={s.list}>
              {visible.map((candidate) => (
                <ConventionCard
                  key={candidate.id}
                  candidate={candidate}
                  busy={update.isPending}
                  evidenceHref={githubEvidenceUrl(
                    activeRepo?.full_name,
                    activeRepo?.default_branch,
                    candidate.evidence_path,
                    candidate.evidence_line,
                  )}
                  selectable={candidate.status === "accepted"}
                  selected={!excluded.has(candidate.id)}
                  onSelect={(on) =>
                    setExcluded((prev) => {
                      const next = new Set(prev);
                      if (on) next.delete(candidate.id);
                      else next.add(candidate.id);
                      return next;
                    })
                  }
                  onStatus={(status) =>
                    update.mutate({ repoId, id: candidate.id, patch: { status } })
                  }
                  onSave={(patch) => update.mutate({ repoId, id: candidate.id, patch })}
                  onDelete={() => remove.mutate({ repoId, id: candidate.id })}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
