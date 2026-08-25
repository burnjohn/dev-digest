/* IntentCard — why this PR was opened, computed at most once per PR lifetime.
   Rendered on the Overview tab, ABOVE the description (REQ-14). Get-or-create
   happens on MOUNT via usePrIntent (see its own comment in lib/hooks/reviews.ts
   for why that hook issues a POST, not a GET) — so a PR that has never been
   reviewed still shows an intent (REQ-8), no user action required.

   Matches the owner's mockup: an INTENT header with a Recompute button, the
   summary as an italic quoted block, and IN SCOPE / OUT OF SCOPE as two
   icon-led lists. The Sources block (per-source status) was removed by owner
   decision — see docs/plans/03-intent-layer.md §12 amendment A6.

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
import { Button, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import type { PrCommit } from "@devdigest/shared";
import { usePrIntent, useReclassifyIntent } from "@/lib/hooks/reviews";
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
}

export function IntentCard({ prId, headSha, prCommits }: IntentCardProps) {
  const t = useTranslations("prReview");
  const { data: intent, isLoading, isError, refetch } = usePrIntent(prId);
  const reclassify = useReclassifyIntent(prId);

  if (!prId) return null;

  if (isLoading) {
    return (
      <section style={s.section}>
        <SectionLabel icon="Target">{t("intent.title")}</SectionLabel>
        <div style={s.card}>
          <Skeleton height={16} width="55%" />
          <Skeleton height={13} width="92%" style={{ marginTop: 12 }} />
          <Skeleton height={13} width="78%" style={{ marginTop: 6 }} />
        </div>
      </section>
    );
  }

  if (isError || !intent) {
    return (
      <section style={s.section}>
        <SectionLabel icon="Target">{t("intent.title")}</SectionLabel>
        <div role="alert" style={s.errorCard}>
          <span>{t("intent.errorBody")}</span>
          <button type="button" style={s.retryButton} onClick={() => refetch()}>
            {t("intent.retry")}
          </button>
        </div>
      </section>
    );
  }

  // Recomputed every render, never held in state: `reclassify` writes straight
  // into the query cache (useReclassifyIntent), so the strip must disappear on
  // that same render rather than one effect later.
  const stale = isIntentStale(intent.generated_at, headSha, prCommits);

  return (
    <section style={s.section}>
      <SectionLabel
        icon="Target"
        right={
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            loading={reclassify.isPending}
            onClick={() => reclassify.mutate()}
          >
            {t("intent.recompute")}
          </Button>
        }
      >
        {t("intent.title")}
      </SectionLabel>
      {stale && (
        <div role="status" style={s.staleNotice}>
          <Icon.AlertTriangle size={14} style={s.staleNoticeIcon} />
          <span>{t("intent.stale")}</span>
        </div>
      )}
      {/* `tabIndex={0}` makes this scrollable-when-overflowing card
          keyboard-reachable (only matters on rare long content, since the
          slot's min height normally leaves room to spare — see
          IntentCard/styles.ts `card`). `role="group"` + `aria-label` reuse
          the card's own title rather than adding a new translation key
          outside this task's owned paths. */}
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
      </div>
    </section>
  );
}
