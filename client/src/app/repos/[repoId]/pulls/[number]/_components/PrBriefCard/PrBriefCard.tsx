/* PrBriefCard — the full-width band at the top of the Overview tab, and ONE
   component: verdict headline, findings badge, the brief's `what`/`why`, the
   PR score ring, the cost strip and the single Recalculate control, all inside
   a single bordered box (mockup 1; the owner's 2026-08-26 revision).

   What it deliberately does NOT show, each by explicit owner decision:
   - the risk-level badge (`Low`/`Medium`/`High`) — removed 2026-08-26;
   - the reviewer/agent name — the band is the PR's headline, not a run's;
   - the review's own `summary` prose — that is the reviewer's findings text and
     belongs to the run accordion on the Findings tab (`VerdictBanner`). The
     prose HERE is always the brief's `what`/`why`.

   The verdict half is PR-WIDE and DERIVED: every number in it is aggregated
   across all agents that reviewed this PR (`_lib/verdict.ts` `aggregatePr`),
   and the headline comes from the aggregate blocker count, never from
   `ReviewRecord.verdict` — see `deriveVerdict` for why the repo does not trust
   that field. Its data costs nothing extra: `usePrReviews` and `usePrRuns` are
   already mounted by the PR page, so both are cache hits, and no server or
   contract work backs this row (`contracts/brief.ts` is untouched by it).

   Recalculate is the Overview tab's ONE refresh control. It re-runs the INTENT
   first and the brief second, because the brief is built from the intent
   (`sources.intent`): refreshing only the brief would key the new brief to the
   old classification. IntentCard has no Recompute button of its own.

   The `risks[]` list is not here either — it renders as `RiskAreas` inside
   IntentCard's card (see RiskAreas.tsx). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, CircularScore, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import { formatCost, formatTokenFlow } from "@/lib/format";
import { usePrBrief, useRecalculateBrief } from "@/lib/hooks/brief";
import { usePrReviews, usePrRuns, useReclassifyIntent } from "@/lib/hooks/reviews";
import { VERDICT_META, aggregatePr } from "../../_lib/verdict";
import { missingSourceKeys, joinSourceNames } from "./helpers";
import { s } from "./styles";

interface PrBriefCardProps {
  prId: string | null;
}

export function PrBriefCard({ prId }: PrBriefCardProps) {
  const t = useTranslations("riskBrief");
  const tPr = useTranslations("prReview");
  const { data: brief, isLoading, isError, refetch } = usePrBrief(prId);
  const { data: reviews } = usePrReviews(prId);
  const { data: runs } = usePrRuns(prId);
  const recalculate = useRecalculateBrief(prId);
  const reclassifyIntent = useReclassifyIntent(prId);
  const pending = recalculate.isPending || reclassifyIntent.isPending;

  if (!prId) return null;

  /* One click, both recalculations, in dependency order.

     `mutateAsync` (not `mutate`) is what makes the ORDER real: the brief's
     POST must not leave until the intent's has landed, or the server builds
     the brief from the row it is in the middle of replacing. A failed
     reclassification is swallowed on purpose — the brief still generates and
     reports `sources.intent: "unavailable"` through the "Built without …"
     note (AC-32), which is a better outcome than refusing to refresh at all.
     Both mutations write their own response into their own query cache with
     `setQueryData` (REQ-29), so neither needs an invalidation here. */
  const recalculateAll = async () => {
    await reclassifyIntent.mutateAsync().catch(() => undefined);
    recalculate.mutate();
  };

  // Icon-only (mockup 1 draws a bare circular arrow inside the band), so it
  // carries its own accessible name — `Button` spreads `...rest` but supplies
  // no `aria-label` of its own.
  const recalculateButton = (
    <Button
      kind="secondary"
      size="sm"
      icon="RefreshCw"
      aria-label={t("recalculate")}
      title={t("recalculate")}
      loading={pending}
      disabled={pending}
      onClick={() => void recalculateAll()}
    />
  );

  if (isLoading) {
    return (
      <section style={s.section}>
        <SectionLabel icon="Gauge">{t("title")}</SectionLabel>
        <div style={s.loadingCard}>
          <Skeleton height={20} width="30%" />
          <Skeleton height={13} width="92%" style={{ marginTop: 14 }} />
          <Skeleton height={13} width="78%" style={{ marginTop: 6 }} />
          {/* Loading copy ends in `…` (SPEC-02 "States the design omits"). */}
          <p style={s.loadingText}>{t("loading")}</p>
        </div>
      </section>
    );
  }

  // A hook's `isError` branch covers a transport failure only (AC-18's `502`)
  // — a malformed payload throws while the component below destructures it,
  // which is exactly what T9's `ErrorBoundary` exists to contain
  // (client/INSIGHTS.md 2026-08-25). Do not widen this branch to also guard
  // against a bad shape.
  if (isError || !brief) {
    return (
      <section style={s.section}>
        <SectionLabel icon="Gauge">{t("title")}</SectionLabel>
        <div role="alert" style={s.errorCard}>
          <span>{t("error")}</span>
          <button type="button" style={s.retryButton} onClick={() => refetch()}>
            {t("retry")}
          </button>
        </div>
      </section>
    );
  }

  const missingKeys = missingSourceKeys(brief.sources);
  // Exactly one note, however many sources are missing (REQ-43/AC-43) — the
  // composition happens once, here, never per-source. It sits on the band
  // rather than beside the risk list because it qualifies the WHOLE brief.
  const builtWithoutNote =
    missingKeys.length > 0
      ? t("builtWithout.note", {
          sources: joinSourceNames(
            missingKeys.map((key) => t(`builtWithout.source.${key}`)),
            t("builtWithout.separator"),
            t("builtWithout.lastSeparator"),
          ),
        })
      : null;

  /* The review half — the WHOLE PR's, not one agent's. A review row only exists
     for a run that COMPLETED, so a null aggregate doubles as the "has this PR
     ever been reviewed" test. No review, no verdict row, no ring, no cost
     strip, and the band is the brief alone: the brief renders before any review
     has run (REQ-14), and an empty verdict shell above it would say nothing.

     `aggregatePr` keeps the newest review per agent and sums from there, so a
     rejecting run stays visible however many agents finish after it, and a
     re-run of one agent replaces its old numbers instead of doubling them. It
     owns the payload shape guards too (`api.get` is a cast with no runtime
     parse — client/INSIGHTS.md 2026-08-25), so a drifted reviews payload
     degrades the band rather than throwing and taking the brief down with it. */
  const agg = aggregatePr(reviews, runs);
  const meta = agg ? VERDICT_META[agg.verdict] : null;
  const VerdictIcon = meta ? Icon[meta.icon] : null;
  const hasCost = agg != null && (agg.costUsd != null || agg.tokensIn != null || agg.tokensOut != null);

  return (
    <section style={s.section}>
      <SectionLabel icon="Gauge">{t("title")}</SectionLabel>
      <div style={s.card}>
        {meta && VerdictIcon && (
          <div style={s.verdictIconBox(meta.bg, meta.c)}>
            <VerdictIcon size={22} />
          </div>
        )}

        <div style={s.main}>
          {meta && agg && (
            <div style={s.titleRow}>
              <span style={s.verdictLabel(meta.c)}>{tPr(`verdict.${meta.labelKey}`)}</span>
              <Badge color="var(--text-secondary)">
                {tPr("verdict.findingsCount", { count: agg.findingsCount })}
                {agg.blockers > 0 ? tPr("verdict.blockers", { count: agg.blockers }) : ""}
              </Badge>
              {/* The `title` goes on a wrapping span, not the icon: lucide
                  components do not accept one, and `role="img"` + `aria-label`
                  is what gives it an accessible name. There is no tooltip
                  primitive and no Floating UI in this repo
                  (client/INSIGHTS.md 2026-08-10). */}
              <span
                style={s.derivedNote}
                title={tPr("verdict.derivedNote")}
                aria-label={tPr("verdict.derivedNote")}
                role="img"
              >
                <Icon.Info size={14} />
              </span>
            </div>
          )}

          {builtWithoutNote && (
            <div role="status" style={s.note}>
              <Icon.Info size={14} style={s.noteIcon} />
              <span>{builtWithoutNote}</span>
            </div>
          )}

          {/* Always the BRIEF's prose — never `review.summary`, which is the
              reviewer's findings text and stays on the Findings tab. */}
          <p style={s.what}>{brief.what}</p>
          <p style={s.why}>{brief.why}</p>
        </div>

        <div style={s.sideCol}>
          {recalculateButton}
          {agg?.score != null && (
            <div style={s.scoreBox}>
              <CircularScore score={agg.score} size={52} stroke={5} />
              <span style={s.scoreLabel}>{tPr("verdict.prScore")}</span>
            </div>
          )}
          {hasCost && agg && (
            <span style={s.costStrip} className="tnum">
              {formatCost(agg.costUsd)} · {formatTokenFlow(agg.tokensIn, agg.tokensOut)}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
