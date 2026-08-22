"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, Skeleton, ErrorState } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useActiveRepo } from "@/lib/contexts/repoContext";
import { useConventions, useExtractConventions } from "@/lib/hooks/conventions";
import { ConventionCard } from "../ConventionCard/ConventionCard";
import { CreateSkillFromConventionsModal } from "../CreateSkillFromConventionsModal/CreateSkillFromConventionsModal";

export function ConventionsView() {
  const t = useTranslations("conventions");
  const { repoId, activeRepo } = useActiveRepo();
  const {
    data: conventions = [],
    isLoading,
    isError,
    refetch,
  } = useConventions(repoId);
  const extract = useExtractConventions();
  const [showModal, setShowModal] = React.useState(false);

  const accepted = conventions.filter((c) => c.accepted);
  const total = conventions.length;
  const extractError =
    extract.error instanceof Error ? extract.error.message : null;

  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumb") }];

  return (
    <AppShell crumb={crumb}>
      {showModal && repoId && (
        <CreateSkillFromConventionsModal
          repoId={repoId}
          repoName={activeRepo?.name ?? "repo"}
          acceptedCount={accepted.length}
          onClose={() => setShowModal(false)}
          onCreated={() => setShowModal(false)}
        />
      )}

      <div style={{ padding: 28, maxWidth: 860 }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: 20,
          }}
        >
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
              {t("page.heading")}{" "}
              <span style={{ color: "var(--accent)" }}>
                {activeRepo?.name ?? "—"}
              </span>
            </h1>
            {total > 0 && (
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
                {t("page.acceptedCount", { count: accepted.length, total })}
              </p>
            )}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <Button
              kind="secondary"
              icon="RefreshCw"
              onClick={() => repoId && extract.mutate(repoId)}
              loading={extract.isPending}
            >
              {t("page.rescan")}
            </Button>
            {accepted.length > 0 && (
              <Button
                kind="primary"
                icon="Sparkles"
                onClick={() => setShowModal(true)}
              >
                {t("page.createSkill")}
              </Button>
            )}
          </div>
        </div>

        {/* Extraction failure — shown above content so it surfaces whether the
            list is empty or populated, instead of silently re-rendering empty. */}
        {extract.isError && (
          <div
            role="alert"
            style={{
              marginBottom: 16,
              padding: "12px 14px",
              borderRadius: 8,
              border: "1px solid var(--danger-border, #5b2526)",
              background: "var(--danger-bg, rgba(220,38,38,0.08))",
              color: "var(--danger-text, #f87171)",
              fontSize: 13,
            }}
          >
            <strong style={{ fontWeight: 600 }}>
              {t("page.extractionFailed")}
            </strong>
            {extractError ? ` — ${extractError}` : null}
          </div>
        )}

        {/* List */}
        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Skeleton height={120} />
            <Skeleton height={120} />
            <Skeleton height={120} />
          </div>
        ) : isError ? (
          <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />
        ) : total === 0 && !extract.isPending ? (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={
              extract.isSuccess && !extract.isError
                ? t("page.empty.bodyAfterScan")
                : t("page.empty.body")
            }
            cta={t("page.empty.cta")}
            onCta={() => repoId && extract.mutate(repoId)}
            ctaLoading={extract.isPending}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {extract.isPending && (
              <div
                style={{
                  padding: 16,
                  textAlign: "center",
                  color: "var(--text-muted)",
                  fontSize: 13,
                }}
              >
                {t("page.scanning")}
              </div>
            )}
            {conventions.map((c) => (
              <ConventionCard
                key={c.id}
                convention={c}
                repoId={repoId!}
                repoUrl={
                  activeRepo
                    ? `https://github.com/${activeRepo.full_name}`
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
