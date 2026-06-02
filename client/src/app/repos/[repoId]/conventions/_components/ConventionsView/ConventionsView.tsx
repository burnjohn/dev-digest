/* Conventions extractor (A1, L02). Scan the cloned repo → candidate cards with
   evidence (file:line snippet + confidence) → Accept as Skill. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../../../components/app-shell";
import { useConventions, useExtractConventions, useAcceptConvention } from "../../../../../../lib/hooks/conventions";
import { useRepos } from "../../../../../../lib/hooks";
import { ApiError } from "../../../../../../lib/api";
import { ConventionCard } from "../ConventionCard";
import { s } from "./styles";

export function ConventionsView() {
  const t = useTranslations("conventions");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { data: repos } = useRepos();
  const repo = repos?.find((r) => r.id === repoId);

  const { data: conventions, isLoading, isError, refetch } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const accept = useAcceptConvention(repoId);
  const [error, setError] = React.useState<string | null>(null);
  const [acceptingId, setAcceptingId] = React.useState<string | null>(null);

  const runExtract = async () => {
    setError(null);
    try {
      await extract.mutateAsync(undefined);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("page.extractionFailed"));
    }
  };

  const onAccept = async (id: string) => {
    setAcceptingId(id);
    try {
      await accept.mutateAsync(id);
    } finally {
      setAcceptingId(null);
    }
  };

  const candidates = conventions ?? [];
  const pending = candidates.filter((c) => !c.accepted);

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }]}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerMain}>
            <h1 style={s.h1}>
              {t("page.headingPrefix")}
              <span className="mono" style={s.repoName}>
                {repo?.name ?? t("page.repoFallback")}
              </span>
            </h1>
            <p style={s.subtitle}>{t("page.subtitle")}</p>
          </div>
          <Button kind="secondary" size="sm" icon="RefreshCw" onClick={runExtract} disabled={extract.isPending}>
            {extract.isPending
              ? t("page.scanning")
              : candidates.length > 0
                ? t("page.rescan")
                : t("page.runExtraction")}
          </Button>
        </div>

        {error && (
          <div style={s.errorWrap}>
            <ErrorState body={error} onRetry={runExtract} />
          </div>
        )}

        {isLoading && (
          <div style={s.skeletonStack}>
            <Skeleton height={150} />
            <Skeleton height={150} />
          </div>
        )}

        {isError && !isLoading && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}

        {!isLoading && !isError && candidates.length === 0 && !extract.isPending && (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={runExtract}
          />
        )}

        {extract.isPending && candidates.length === 0 && (
          <div style={s.skeletonStack}>
            <Skeleton height={150} />
            <Skeleton height={150} />
          </div>
        )}

        {candidates.length > 0 && (
          <>
            {pending.length > 0 && (
              <div style={s.candidateCount}>{t("page.candidateCount", { count: pending.length })}</div>
            )}
            {candidates.map((c) => (
              <ConventionCard key={c.id} c={c} accepting={acceptingId === c.id} onAccept={() => onAccept(c.id)} />
            ))}
          </>
        )}
      </div>
    </AppShell>
  );
}
