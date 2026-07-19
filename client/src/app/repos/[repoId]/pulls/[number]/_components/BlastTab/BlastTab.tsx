/* BlastTab — PR-detail "Blast radius" tab (L04).
   Thin data shell: fetch via useBlast, render loading / error / the impact map.
   The heavy view (tree + graph) lives in _components/BlastRadius. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Skeleton, ErrorState, Button } from "@devdigest/ui";
import { BlastRadiusView } from "../BlastRadius";
import { useBlast } from "@/lib/hooks/blast";

interface BlastTabProps {
  prId: string | null;
  /** Jump-to-code: clicking a caller location switches to the Files tab. */
  onWhy?: (file: string, line: number) => void;
}

export function BlastTab({ prId, onWhy }: BlastTabProps) {
  const t = useTranslations("blast");
  const { data: blast, isLoading, isFetching, error, refetch } = useBlast(prId);

  const refresh = (
    <Button
      kind="tertiary"
      size="sm"
      icon="RefreshCw"
      loading={isFetching}
      disabled={!prId || isFetching}
      onClick={() => refetch()}
      title={t("refresh")}
    >
      {t("refresh")}
    </Button>
  );

  return (
    <section>
      <SectionLabel icon="GitBranch" right={refresh}>
        Blast radius
      </SectionLabel>
      {isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton height={18} width="40%" />
          <Skeleton height={14} />
          <Skeleton height={14} width="80%" />
        </div>
      ) : error ? (
        <ErrorState
          body={error instanceof Error ? error.message : "Couldn't compute the blast radius."}
          onRetry={() => refetch()}
        />
      ) : blast ? (
        <BlastRadiusView blast={blast} onWhy={onWhy} />
      ) : null}
    </section>
  );
}

export default BlastTab;
