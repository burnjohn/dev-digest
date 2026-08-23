"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import type { PrCommit } from "@devdigest/shared";
import { IntentCard } from "../IntentCard";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  prBody: string | null | undefined;
  /** Passed straight through to IntentCard, which joins the two to tell
      whether the intent predates the current head commit. */
  headSha?: string | null;
  prCommits?: PrCommit[];
}

export function OverviewTab({ prId, prBody, headSha, prCommits }: OverviewTabProps) {
  const t = useTranslations("prReview");
  return (
    <>
      {/* Intent renders BEFORE the description, and before any review result
          (REQ-14) — it describes the PR's purpose even when no review has run. */}
      <IntentCard prId={prId} headSha={headSha} prCommits={prCommits} />

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">{t("overview.description")}</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
