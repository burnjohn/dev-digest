/* IntentCard — why this PR was opened, computed at most once per PR lifetime.
   Rendered on the Overview tab, ABOVE the description (REQ-14). Get-or-create
   happens on MOUNT via usePrIntent (see its own comment in lib/hooks/reviews.ts
   for why that hook issues a POST, not a GET) — so a PR that has never been
   reviewed still shows an intent (REQ-8), no user action required.

   Matches the owner's mockup: the summary as an italic quoted block, and IN
   SCOPE / OUT OF SCOPE as two icon-led lists. The Sources block (per-source
   status) was removed by owner decision — see docs/plans/03-intent-layer.md
   §12 amendment A6.

   2026-08-26: this card no longer carries its own Recompute button. The
   Overview tab has ONE refresh control, `PrBriefCard`'s Recalculate, and it
   drives the intent and the brief in that order — the brief is built FROM the
   intent, so two separate buttons meant the obvious click order produced a
   brief keyed to the previous classification. This card therefore does not
   mount `useReclassifyIntent` at all any more; it only reads.

   2026-08-26: this card gained a `children` slot, rendered inside the card box
   below a divider. SPEC-02's N3 ("IntentCard ships untouched") is amended:
   both mockups draw RISK AREAS in the SAME bordered card as IN SCOPE / OUT OF
   SCOPE, and the owner reversed the separate-card decision after seeing it
   rendered. The slot keeps this card ignorant of what fills it — OverviewTab
   passes `<RiskAreas>` in, already wrapped in its own ErrorBoundary, and this
   file never touches the brief query.

   The confidence badge was removed on 2026-08-24, during the Overview-tab
   layout work that gave this card and BlastCard matching heights. It shared a
   flex row with the summary, which shortened the quote and pulled it off the
   card's left rule. Recorded honestly: the removal was made by an implementer
   outside its task scope and was NOT authorised in advance — the owner
   reviewed it after the fact and chose to keep it. The `summaryRow` wrapper
   and `intent.confidence` went with it; `intent.confidence` remains on the
   wire contract and is simply not rendered. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import type { PrCommit } from "@devdigest/shared";
import { usePrIntent } from "@/lib/hooks/reviews";
import { isIntentStale } from "./helpers";
import { s } from "./styles";

interface IntentCardProps {
  prId: string | null;
  /** Current head of the PR branch. Optional on purpose — the card must still
      render (minus the staleness strip) for a caller that has no PrDetail. */
  headSha?: string | null;
  /** Supplies the head commit's timestamp; see helpers.ts for why the join
      lives on the client and what it cannot prove. */
  prCommits?: PrCommit[];
  /** An extra section rendered INSIDE the card, below the scope grid and a
      divider. The caller owns its data, its loading/error states and its
      error boundary — this card only gives it a place to sit. Rendered in
      every branch (loading, error, loaded) on purpose: a failed intent fetch
      must not also take down a section that has nothing to do with it. */
  children?: React.ReactNode;
}

export function IntentCard({ prId, headSha, prCommits, children }: IntentCardProps) {
  const t = useTranslations("prReview");
  const { data: intent, isLoading, isError, refetch } = usePrIntent(prId);

  if (!prId) return null;

  const slot = children ? (
    <>
      <div style={s.divider} />
      {children}
    </>
  ) : null;

  if (isLoading) {
    return (
      <section style={s.section}>
        <SectionLabel icon="Target">{t("intent.title")}</SectionLabel>
        <div style={s.card}>
          <Skeleton height={16} width="55%" />
          <Skeleton height={13} width="92%" style={{ marginTop: 12 }} />
          <Skeleton height={13} width="78%" style={{ marginTop: 6 }} />
          {slot}
        </div>
      </section>
    );
  }

  if (isError || !intent) {
    return (
      <section style={s.section}>
        <SectionLabel icon="Target">{t("intent.title")}</SectionLabel>
        {/* The card box, not the alert row itself, is what carries the border
            here — the row has to share the box with `slot` below it. */}
        <div style={s.card}>
          <div role="alert" style={s.errorRow}>
            <span>{t("intent.errorBody")}</span>
            <button type="button" style={s.retryButton} onClick={() => refetch()}>
              {t("intent.retry")}
            </button>
          </div>
          {slot}
        </div>
      </section>
    );
  }

  // Recomputed every render, never held in state: the band's Recalculate
  // writes straight into `["pr-intent", prId]` (useReclassifyIntent's
  // `setQueryData`), so the strip must disappear on that same render rather
  // than one effect later — that holds whichever component owns the button.
  const stale = isIntentStale(intent.generated_at, headSha, prCommits);

  return (
    <section style={s.section}>
      <SectionLabel icon="Target">{t("intent.title")}</SectionLabel>
      {stale && (
        <div role="status" style={s.staleNotice}>
          <Icon.AlertTriangle size={14} style={s.staleNoticeIcon} />
          <span>{t("intent.stale")}</span>
        </div>
      )}
      {/* `tabIndex={0}` makes this scrollable-when-overflowing card
          keyboard-reachable (it overflows routinely now that the risk areas
          share it — see IntentCard/styles.ts `card`). `role="group"` +
          `aria-label` reuse the card's own title rather than adding a new
          translation key outside this task's owned paths. */}
      <div style={s.card} tabIndex={0} role="group" aria-label={t("intent.title")}>
        {/* The contract's summary field is `intent`, not `summary` — labeled
            "Summary" in the UI only (docs/plans/03-intent-layer.md §5.6/D7). */}
        <p style={s.summary}>{intent.intent}</p>

        <div style={s.scopeGrid}>
          <div>
            <div style={s.scopeLabel}>{t("intent.inScope")}</div>
            {intent.in_scope.length > 0 ? (
              <ul style={s.scopeList}>
                {intent.in_scope.map((item) => (
                  <li key={item} style={s.scopeRow}>
                    <Icon.CheckCircle size={14} style={s.scopeIcon("var(--ok)")} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div style={s.scopeEmpty}>—</div>
            )}
          </div>
          <div>
            <div style={s.scopeLabel}>{t("intent.outOfScope")}</div>
            {intent.out_of_scope.length > 0 ? (
              <ul style={s.scopeList}>
                {intent.out_of_scope.map((item) => (
                  <li key={item} style={s.scopeRow}>
                    <Icon.XCircle size={14} style={s.scopeIcon("var(--text-muted)")} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div style={s.scopeEmpty}>—</div>
            )}
          </div>
        </div>

        {slot}
      </div>
    </section>
  );
}
