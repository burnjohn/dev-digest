"use client";

import React from "react";
import { useParams } from "next/navigation";
import { Button, EmptyState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useActiveRepo } from "@/lib/repo-context";
import {
  useConventions,
  useExtractConventions,
  useAcceptConvention,
  useRejectConvention,
  useUpdateConvention,
} from "@/lib/hooks/conventions";
import { ConventionCard } from "./_components/ConventionCard/ConventionCard";
import { PromoteModal } from "./_components/PromoteModal/PromoteModal";

export default function ConventionsPage() {
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();

  const repoUrl = activeRepo
    ? `https://github.com/${activeRepo.owner}/${activeRepo.name}`
    : "";
  const repoName = activeRepo?.full_name ?? repoId;
  const shortName = repoName.includes("/") ? repoName.split("/")[1] : repoName;

  const { data: candidates, isLoading } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const accept = useAcceptConvention(repoId);
  const reject = useRejectConvention(repoId);
  const update = useUpdateConvention(repoId);

  const [showPromote, setShowPromote] = React.useState(false);

  const accepted = (candidates ?? []).filter((c) => c.accepted);
  const allAccepted = candidates && candidates.length > 0 && accepted.length === candidates.length;

  const handleDeselectAll = () => {
    accepted.forEach((c) => reject.mutate(c.id));
  };

  return (
    <AppShell crumb={[{ label: repoName, mono: true }, { label: "Conventions" }]}>
      <div style={{ padding: "32px 40px", maxWidth: 900 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 28 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
              Conventions in{" "}
              <span style={{ color: "var(--accent)" }}>{shortName}</span>
            </h1>
            {candidates && (
              <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
                Detected from {candidates.length} candidate(s)
              </p>
            )}
          </div>
          <Button
            kind="secondary"
            icon="RefreshCw"
            loading={extract.isPending}
            onClick={() => extract.mutate()}
          >
            Re-scan
          </Button>
        </div>

        {/* Sub-header: select controls + create skill */}
        {candidates && candidates.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 16,
              paddingBottom: 16,
              borderBottom: "1px solid var(--border)",
            }}
          >
            <Button size="sm" kind="ghost" icon="X" onClick={handleDeselectAll}>
              Deselect all
            </Button>
            <span style={{ fontSize: 13, color: "var(--text-secondary)", flex: 1 }}>
              {accepted.length} of {candidates.length} accepted
            </span>
            <Button
              kind="primary"
              icon="Sparkles"
              disabled={accepted.length === 0}
              onClick={() => setShowPromote(true)}
            >
              Create skill
            </Button>
          </div>
        )}

        {/* Content */}
        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[1, 2, 3].map((i) => <Skeleton key={i} height={160} />)}
          </div>
        ) : extract.isPending ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>
              Analyzing repository files…
            </p>
            {[1, 2, 3].map((i) => <Skeleton key={i} height={160} />)}
          </div>
        ) : !candidates || candidates.length === 0 ? (
          <EmptyState
            icon="Sparkles"
            title="No conventions yet"
            body='Click "Re-scan" to analyze the repository and extract conventions.'
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {candidates.map((c) => (
              <ConventionCard
                key={c.id}
                candidate={c}
                repoUrl={repoUrl}
                onAccept={() => accept.mutate(c.id)}
                onReject={() => reject.mutate(c.id)}
                onEdit={(rule) => update.mutate({ cid: c.id, patch: { rule } })}
              />
            ))}
          </div>
        )}
      </div>

      {showPromote && (
        <PromoteModal
          repoId={repoId}
          repoUrl={repoUrl}
          repoName={repoName}
          accepted={accepted}
          onClose={() => setShowPromote(false)}
        />
      )}
    </AppShell>
  );
}
