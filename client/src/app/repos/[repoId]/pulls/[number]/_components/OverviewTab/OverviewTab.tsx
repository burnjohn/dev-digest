"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, SectionLabel } from "@devdigest/ui";
import type { PrCommit } from "@devdigest/shared";
import { ErrorBoundary } from "@/components/error-boundary";
import { IntentCard } from "../IntentCard";
import { BlastCard } from "../BlastCard";
import { PrBriefCard, RiskAreas } from "../PrBriefCard";
import { ReviewFocusCard } from "../ReviewFocusCard";
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

  /* Every section reads server data through hooks whose responses are
     TypeScript casts, not runtime-validated shapes (`lib/api.ts`), so a
     malformed payload throws while the card is DESTRUCTURING it — after
     TanStack Query has already resolved, which is why none of the cards' own
     `isError` branches cover this. Unboxed, that throw reaches
     `app/error.tsx` and blanks the entire PR page; boxed, it costs one card.

     Each of the five sections (PrBriefCard, IntentCard, RiskAreas, BlastCard,
     ReviewFocusCard) gets its OWN boundary, never one shared: they read data
     the same way and carry the identical exposure, but a shared boundary would
     mean one broken payload takes down every card behind it. RiskAreas has one
     of its own even though it renders INSIDE IntentCard — it reads the brief,
     IntentCard reads the intent, and a bad brief must not blank the intent.
     `resetKeys={[prId]}` clears a tripped section when the user navigates to
     another PR, so one bad response does not follow them around. Reuses
     `common.states.error` / `common.actions.retry` — no new message keys. */
  const cardFallback = (reset: () => void) => (
    <EmptyState icon="AlertTriangle" title={tCommon("states.error")} cta={tCommon("actions.retry")} onCta={reset} />
  );

  return (
    <>
      {/* The layout, top to bottom (reworked 2026-08-26 to match mockup 1;
          SPEC-02 AC-26 and design-review item 3 were amended with it):

            PR BRIEF band — full width, content height, above the grid
            INTENT (+ RISK AREAS inside its card) | BLAST RADIUS — the grid
            REVIEW FOCUS band — full width, below the grid

          The two bands are top-level Fragment children, so they inherit
          page.tsx's own `gap: 24` flex-column rhythm with no margin here. The
          grid reflows intrinsically — no media query, never a `tab === "blast"`
          branch. Every section renders BEFORE the description and before any
          review result (REQ-14): they describe the PR's purpose, risk and
          impact even when no review has run. */}
      <ErrorBoundary fallback={cardFallback} resetKeys={[prId]}>
        <PrBriefCard prId={prId} />
      </ErrorBoundary>

      <div style={s.cardGrid}>
        {/* Each card sits in its own height-capped slot (OverviewTab/styles.ts
            `cardSlot`) so it cannot grow unboundedly and drag the row with it
            — IntentCard scrolls its own card, BlastCard its `symbolList`. */}
        <div style={s.cardSlot}>
          <ErrorBoundary fallback={cardFallback} resetKeys={[prId]}>
            <IntentCard prId={prId} headSha={headSha} prCommits={prCommits}>
              <ErrorBoundary fallback={cardFallback} resetKeys={[prId]}>
                {/* `repoFullName`/`headSha` pass through nullable and
                    un-narrowed, exactly as they do to BlastCard and
                    ReviewFocusCard: the section degrades a risk row's path to
                    plain text when either is missing rather than building a
                    URL out of a uuid (client/INSIGHTS.md 2026-08-17). */}
                <RiskAreas prId={prId} repoFullName={repoFullName} headSha={headSha} />
              </ErrorBoundary>
            </IntentCard>
          </ErrorBoundary>
        </div>
        <div style={s.cardSlot}>
          <ErrorBoundary fallback={cardFallback} resetKeys={[prId]}>
            <BlastCard prId={prId} repoFullName={repoFullName} headSha={headSha} />
          </ErrorBoundary>
        </div>
      </div>

      {/* ReviewFocusCard: a full-width band below the grid, never a grid
          cell of `cardGrid` above (REQ-27). `repoFullName`/`headSha` pass
          through unchanged — nullable, un-narrowed, no `!` assertion — the
          card itself degrades to plain text when either is missing
          (client/INSIGHTS.md 2026-08-17), not this tab's job. */}
      <ErrorBoundary fallback={cardFallback} resetKeys={[prId]}>
        <ReviewFocusCard prId={prId} repoFullName={repoFullName} headSha={headSha} />
      </ErrorBoundary>

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">{t("overview.description")}</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
