"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, SectionLabel } from "@devdigest/ui";
import type { PrCommit } from "@devdigest/shared";
import { ErrorBoundary } from "@/components/error-boundary";
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
  const tCommon = useTranslations("common");

  /* Both cards read server data through hooks whose responses are TypeScript
     casts, not runtime-validated shapes (`lib/api.ts`), so a malformed payload
     throws while the card is DESTRUCTURING it — after TanStack Query has
     already resolved, which is why neither card's own `isError` branch covers
     this. Unboxed, that throw reaches `app/error.tsx` and blanks the entire PR
     page; boxed, it costs one card.

     Both cards are wrapped, not just BlastCard: they sit in identical slots,
     read data the same way and carry the identical exposure. Wrapping one and
     not the other would be an accident waiting on whichever payload breaks
     first. `resetKeys={[prId]}` clears a tripped card when the user navigates
     to another PR, so one bad response does not follow them around. Reuses
     `common.states.error` / `common.actions.retry` — no new message keys. */
  const cardFallback = (reset: () => void) => (
    <EmptyState icon="AlertTriangle" title={tCommon("states.error")} cta={tCommon("actions.retry")} onCta={reset} />
  );

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
          <ErrorBoundary fallback={cardFallback} resetKeys={[prId]}>
            <IntentCard prId={prId} headSha={headSha} prCommits={prCommits} />
          </ErrorBoundary>
        </div>
        <div style={s.cardSlot}>
          <ErrorBoundary fallback={cardFallback} resetKeys={[prId]}>
            <BlastCard prId={prId} repoFullName={repoFullName} headSha={headSha} />
          </ErrorBoundary>
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
