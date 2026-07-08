/* /repos/:repoId/conventions — Conventions Extractor page. */
"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import { Button, Skeleton, EmptyState, ErrorState, Icon } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import {
  useConventions,
  useConventionScans,
  useExtractConventions,
  usePatchConvention,
  useCreateConventionSkills,
} from "@/lib/hooks/conventions";
import { ConventionCard } from "./_components/ConventionCard/ConventionCard";
import { SkillDraftModal } from "./_components/SkillDraftModal/SkillDraftModal";
import type { ConventionSkillInput } from "@devdigest/shared";

export default function ConventionsPage() {
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data: scans, isLoading: scansLoading } = useConventionScans(repoId);
  const { data: conventions, isLoading: convLoading, isError, refetch } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const patch = usePatchConvention(repoId);
  const createSkills = useCreateConventionSkills(repoId);

  const [modalOpen, setModalOpen] = useState(false);

  const latestScan = scans?.[0];
  const isScanning =
    latestScan?.status === "running" ||
    latestScan?.status === "pending" ||
    extract.isPending;

  const accepted = (conventions ?? []).filter(
    (c) => c.status === "accepted" || c.status === "edited",
  );
  const total = conventions?.length ?? 0;

  if (repoNotFound) return <RepoNotFound />;

  const crumb = [
    { label: activeRepo?.full_name ?? "Repo" },
    { label: "Conventions" },
  ];

  const handleExtract = () => extract.mutate();
  const handleAccept = (id: string) => patch.mutate({ id, action: "accept" });
  const handleReject = (id: string) => patch.mutate({ id, action: "reject" });
  const handleUndo   = (id: string) => patch.mutate({ id, action: "undo" });
  const handleEdit   = (id: string, rule: string) => patch.mutate({ id, action: "edit", rule });
  const handleCreateSkills = (input: ConventionSkillInput) => {
    createSkills.mutate(input, { onSuccess: () => setModalOpen(false) });
  };

  const isLoading = scansLoading || convLoading;

  return (
    <AppShell crumb={crumb}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px" }}>
        {/* ── Page header ── */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: 28,
            gap: 16,
          }}
        >
          <div>
            <h1
              style={{
                fontSize: 22,
                fontWeight: 600,
                margin: 0,
                color: "var(--text-primary)",
                lineHeight: 1.3,
              }}
            >
              Conventions in{" "}
              <span style={{ color: "var(--accent)" }}>
                {activeRepo?.name ?? "…"}
              </span>
            </h1>

            {/* accepted count / scanning status */}
            {isScanning ? (
              <p
                style={{
                  margin: "6px 0 0",
                  fontSize: 13,
                  color: "var(--text-muted)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Icon.RefreshCw
                  size={13}
                  style={{ animation: "spin 1s linear infinite" }}
                />
                Scanning repository…
              </p>
            ) : total > 0 ? (
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-muted)" }}>
                {accepted.length} of {total} accepted
              </p>
            ) : (
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-muted)" }}>
                Scan the repo to surface house-rules backed by real evidence.
              </p>
            )}
          </div>

          {/* Header action buttons */}
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <Button
              kind="secondary"
              icon="RefreshCw"
              loading={isScanning}
              disabled={isScanning}
              onClick={handleExtract}
            >
              {latestScan ? "Re-scan" : "Run scan"}
            </Button>

            {accepted.length > 0 && (
              <Button
                kind="primary"
                icon="Sparkles"
                onClick={() => setModalOpen(true)}
              >
                Create skill
              </Button>
            )}
          </div>
        </div>

        {/* ── Body ── */}
        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} style={{ height: 180, borderRadius: 10 }} />
            ))}
          </div>
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : !conventions || conventions.length === 0 ? (
          <EmptyState
            icon="ListChecks"
            title="No conventions extracted yet"
            body="Scan the repo to surface house-rules — naming, error handling, structure — each backed by evidence you can turn into a Skill."
            cta="Run scan"
            onCta={handleExtract}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {conventions.map((c) => (
              <ConventionCard
                key={c.id}
                convention={c}
                onAccept={handleAccept}
                onReject={handleReject}
                onUndo={handleUndo}
                onEdit={handleEdit}
                loading={patch.isPending}
              />
            ))}
          </div>
        )}
      </div>

      {modalOpen && (
        <SkillDraftModal
          accepted={accepted}
          repoName={activeRepo?.name}
          onSave={handleCreateSkills}
          onClose={() => setModalOpen(false)}
          loading={createSkills.isPending}
        />
      )}

      {/* Spin keyframe for the scanning icon */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </AppShell>
  );
}
