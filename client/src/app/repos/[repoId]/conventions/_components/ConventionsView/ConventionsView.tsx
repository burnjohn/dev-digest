/* ConventionsView — /repos/:repoId/conventions.

   The repo's own house rules, proposed and triaged. Extraction is a single
   synchronous POST (7 cheap model calls server-side), so `extract.isPending` IS
   the scanning state — there is no job to poll and no SSE stream to subscribe to.

   Every candidate on this page has already been grounded server-side: the
   `file:line` chip points at a line the snippet was actually found on, not the one
   the model claimed. That is why the page can offer "accept" as a one-click
   gesture — the evidence is checkable before the user is asked to trust it.

   Layout note: `AppFrame`'s <main> supplies no padding and no max width, so the
   page owns its own container (`s.page`) — the same value Agents and Skills use. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import {
  useConventions,
  useExtractConventions,
  useUpdateConvention,
} from "@/lib/hooks/conventions";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ApiError } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { ConventionCard } from "../ConventionCard";
import { CreateSkillFromConventionsModal } from "../CreateSkillFromConventionsModal";
import { SKELETON_CARDS } from "./constants";
import { acceptedOf, sortByConfidence, triageTotal } from "./helpers";
import { s } from "./styles";

export function ConventionsView() {
  const t = useTranslations("conventions");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data, isLoading, isError, error, refetch } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const update = useUpdateConvention(repoId);
  const [modalOpen, setModalOpen] = React.useState(false);

  // The heading wants the bare repo name (`payments-api`), not `acme/payments-api`.
  const fullName = activeRepo?.full_name ?? repoId;
  const shortName = fullName.includes("/") ? fullName.split("/").pop()! : fullName;
  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }];

  const candidates = data?.candidates ?? [];
  const accepted = acceptedOf(candidates);
  const ranked = sortByConfidence(candidates);
  const lastScan = data?.last_scan ?? null;

  const setStatus = (id: string, status: "pending" | "accepted" | "rejected") =>
    update.mutate({ id, patch: { status } });

  // `relativeTime` yields "now" | "5m" | "3h" | "2d"; only the last three read as
  // an elapsed span, so "now" gets its own phrasing rather than "now ago".
  const scannedWhen = (iso: string) => {
    const rel = relativeTime(iso);
    return rel === "now" ? t("page.justNow") : t("page.ago", { rel });
  };

  // What the gates threw away. Shown because "12 candidates" without it silently
  // hides that the model proposed 20 — the drop counts are the evidence that the
  // grounding, dedup and support gates are doing anything.
  const dropped = lastScan
    ? [
        lastScan.dropped_ungrounded > 0
          ? t("page.droppedUngrounded", { count: lastScan.dropped_ungrounded })
          : null,
        lastScan.dropped_unsupported > 0
          ? t("page.droppedUnsupported", { count: lastScan.dropped_unsupported })
          : null,
        lastScan.dropped_duplicate > 0
          ? t("page.droppedDuplicate", { count: lastScan.dropped_duplicate })
          : null,
      ].filter(Boolean)
    : [];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <RepoNotFound />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.pageHeader}>
          <div>
            <h1 style={s.pageTitle}>
              {t("page.headingPrefix")}
              <span className="mono" style={s.repoName} translate="no">
                {shortName}
              </span>
            </h1>
            <p style={s.pageSubtitle}>
              {lastScan
                ? t("page.detectedFrom", {
                    count: lastScan.sampled_files,
                    when: scannedWhen(lastScan.created_at),
                  })
                : t("page.subtitle")}
            </p>
            {dropped.length > 0 && <p style={s.pageSubtitle}>{dropped.join(" · ")}</p>}
          </div>
          <div style={s.headerActions}>
            <Button
              kind="secondary"
              icon="RefreshCw"
              loading={extract.isPending}
              onClick={() => extract.mutate()}
            >
              {extract.isPending ? t("page.scanning") : t("page.rescan")}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div style={s.loadingStack}>
            {Array.from({ length: SKELETON_CARDS }).map((_, i) => (
              <Skeleton key={i} height={120} />
            ))}
          </div>
        ) : isError ? (
          <ErrorState
            title={t("page.loadError")}
            body={error instanceof ApiError ? error.message : undefined}
            onRetry={() => refetch()}
          />
        ) : candidates.length === 0 ? (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={() => extract.mutate()}
            ctaLoading={extract.isPending}
          />
        ) : (
          <>
            <div style={s.toolbar}>
              <Button
                kind="ghost"
                size="sm"
                icon="X"
                disabled={accepted.length === 0 || update.isPending}
                onClick={() => {
                  // Un-accept back to `pending`, never to `rejected`: "deselect" is
                  // undoing a choice, and rejecting is a decision the extractor
                  // remembers forever.
                  for (const c of accepted) setStatus(c.id, "pending");
                }}
              >
                {t("page.deselectAll")}
              </Button>
              {/* Accepting a rule changes this count with no other announcement —
                  without a live region a screen-reader user gets no feedback that
                  the click landed. */}
              <span style={s.triageCount} aria-live="polite">
                {t("page.acceptedCount", {
                  accepted: accepted.length,
                  total: triageTotal(candidates),
                })}
              </span>
              <div style={s.toolbarRight}>
                <Button
                  kind="primary"
                  icon="Sparkles"
                  disabled={accepted.length === 0}
                  title={accepted.length === 0 ? t("page.createSkillDisabledTitle") : undefined}
                  onClick={() => setModalOpen(true)}
                >
                  {t("page.createSkill")}
                </Button>
              </div>
            </div>

            {/* One flat run, strongest rule first. Fixed-order category sections
                used to sit here and buried the ranking — a 30% `naming` rule
                outranked a 90% `typing` one purely by category. The category is a
                chip on the card now, so nothing is lost. */}
            {ranked.map((c) => (
              <ConventionCard
                key={c.id}
                candidate={c}
                repoId={repoId}
                // NOT the `fullName` const above — that falls back to `repoId`, a
                // uuid, which would build a github.com URL that cannot resolve.
                repoFullName={activeRepo?.full_name ?? null}
                gitRef={activeRepo?.default_branch ?? null}
                onAccept={() => setStatus(c.id, "accepted")}
                onReject={() => setStatus(c.id, "rejected")}
              />
            ))}
          </>
        )}
      </div>

      {modalOpen && (
        <CreateSkillFromConventionsModal
          repoId={repoId}
          repoName={shortName}
          acceptedIds={accepted.map((c) => c.id)}
          onClose={() => setModalOpen(false)}
        />
      )}
    </AppShell>
  );
}
