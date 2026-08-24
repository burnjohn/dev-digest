"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import type { PrCommit } from "@devdigest/shared";
import { IntentCard } from "../IntentCard";
import { BlastCard } from "../BlastCard";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  prBody: string | null | undefined;
  /** Passed straight through to IntentCard, which joins the two to tell
      whether the intent predates the current head commit. */
  headSha?: string | null;
  prCommits?: PrCommit[];
  /** Passed straight through to BlastCard, which builds caller `file:line`
      links from it (REQ-12) — never build a URL from a `fullName` that falls
      back to a uuid (client/INSIGHTS.md 2026-08-17). */
  repoFullName?: string | null;
}

export function OverviewTab({ prId, prBody, headSha, prCommits, repoFullName }: OverviewTabProps) {
  const t = useTranslations("prReview");
  return (
    <>
      {/* D1: IntentCard and BlastCard render side by side in a two-column
          grid (the mockup), collapsing to one column on narrow viewports —
          never a `tab === "blast"` branch. Both render BEFORE the
          description, and before any review result (REQ-14) — they describe
          the PR's purpose and impact even when no review has run. */}
      <div style={s.cardGrid}>
        {/* Each card sits in its own height-capped slot (OverviewTab/styles.ts
            `cardSlot`) so the two match height without either being able to
            grow the row unboundedly — see BlastCard/styles.ts `symbolList`
            for where the actual scrolling happens. */}
        <div style={s.cardSlot}>
          <IntentCard prId={prId} headSha={headSha} prCommits={prCommits} />
        </div>
        <div style={s.cardSlot}>
          <BlastCard prId={prId} repoFullName={repoFullName} headSha={headSha} />
        </div>
      </div>

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">{t("overview.description")}</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
