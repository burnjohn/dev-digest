/* BlastCard — "what else could this diff touch?" (docs/plans/06-blast-radius.md).
   Rendered on the Overview tab BESIDE IntentCard (owner decision D1) — never
   a `tab === "blast"` branch. The Tree body is bounded to exactly
   symbol -> callers -> endpoint/cron chips (A1): `file_impact[]` still feeds
   the count strip's totals but is otherwise unused by the UI.

   Owner amendment, 2026-08-24 (amends T6/REQ-14): the `Tree | Graph`
   segmented toggle is GONE. The Tree body below is unconditional.

   Owner amendment, 2026-08-24 (later): the `Graph` view is removed entirely
   — no `Graph` button, no modal, no force-directed layout. The Tree is the
   only view; `file_impact[]` renders nowhere in this card. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SectionLabel, Skeleton, MonoLink } from "@devdigest/ui";
import type { BlastSymbolImpact } from "@devdigest/shared";
import { useBlastRadius } from "@/lib/hooks/blast";
import { githubBlobUrl } from "@/lib/github-urls";
import { PriorPrs } from "./PriorPrs";
import { SYMBOL_PAGE, displayCount, isNonOk, splitChips } from "./helpers";
import { s } from "./styles";

interface BlastCardProps {
  prId: string | null;
  /** Owner/repo, used to build github.com caller links (REQ-12). Optional on
      purpose — the card must still render (minus working caller links) for a
      caller with no repo yet (client/INSIGHTS.md 2026-08-17: never fall back
      to a uuid here — read `activeRepo?.full_name` and pass that through). */
  repoFullName?: string | null;
  /** Current head of the PR branch — the `#L` anchor's commit pin. */
  headSha?: string | null;
}

export function BlastCard({ prId, repoFullName, headSha }: BlastCardProps) {
  const t = useTranslations("blast");
  const { data: blast, isLoading, isError, refetch } = useBlastRadius(prId);
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(new Set());
  // "Show all N symbols" — the only piece of state; the visible slice itself
  // is derived below during render (never stored), so it can never drift
  // from `blast.symbols`.
  const [showAllSymbols, setShowAllSymbols] = React.useState(false);

  if (!prId) return null;

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (isLoading) {
    return (
      <section style={s.section}>
        <SectionLabel icon="Workflow">{t("title")}</SectionLabel>
        <div style={s.card}>
          <Skeleton height={16} width="45%" />
          <Skeleton height={13} width="80%" style={{ marginTop: 14 }} />
          <Skeleton height={13} width="60%" style={{ marginTop: 6 }} />
        </div>
      </section>
    );
  }

  if (isError || !blast) {
    return (
      <section style={s.section}>
        <SectionLabel icon="Workflow">{t("title")}</SectionLabel>
        <div role="alert" style={s.errorCard}>
          <span>{t("error")}</span>
          <button type="button" style={s.retryButton} onClick={() => refetch()}>
            {t("retry")}
          </button>
        </div>
      </section>
    );
  }

  const { totals, coverage, symbols, status, status_reason, prior_prs, narrative } = blast;

  return (
    <section style={s.section}>
      <SectionLabel icon="Workflow">{t("title")}</SectionLabel>
      <div style={s.card}>
        {isNonOk(status) && (
          <div role="status" style={s.banner}>
            <Icon.AlertTriangle size={14} style={s.bannerIcon} />
            <span style={s.bannerText}>{status_reason}</span>
          </div>
        )}

        {/* T10/REQ-19: `narrative` is `null` by default (the flag is off) —
            render NOTHING in that case, no placeholder and no skeleton for a
            field that is simply absent. When present it is a single paragraph,
            rendered once and labelled as AI-generated (OWASP "label
            AI-generated content"), text only — never dangerouslySetInnerHTML,
            since this is model output. Presentation mirrors IntentCard's
            italic quote block (IntentCard/styles.ts `summary`). */}
        {narrative != null && (
          <div style={s.narrativeWrap}>
            <div style={s.narrativeLabel}>
              <Icon.Sparkles size={12} style={s.narrativeLabelIcon} />
              <span>{t("narrative.label")}</span>
            </div>
            <p style={s.narrativeText}>{narrative}</p>
          </div>
        )}

        <div style={s.statsRow}>
          <div style={s.stats}>
            <StatItem
              icon="Code"
              label={t("stat.symbols")}
              value={displayCount(true, totals.symbols)}
            />
            <StatItem
              icon="CornerDownRight"
              label={t("stat.callers")}
              value={displayCount(coverage.callers_available, totals.callers)}
            />
            <StatItem
              icon="Globe"
              label={t("stat.endpoints")}
              value={displayCount(coverage.endpoints_available, totals.endpoints)}
            />
            <StatItem
              icon="Clock"
              label={t("stat.crons")}
              value={displayCount(coverage.crons_available, totals.crons)}
            />
          </div>
        </div>

        {/* The Tree body is the only view (A1 still bounds it: symbol ->
            callers -> chips, and nothing else — `file_impact[]` renders
            nowhere in this card). */}
        {symbols.length === 0 ? (
          <div style={s.empty}>{t("empty")}</div>
        ) : (
          // `tabIndex={0}` makes the scroll region keyboard-reachable —
          // without it, a keyboard user has no way to scroll a
          // capped-height list that has no other focusable ancestor.
          // `role="group"` + `aria-label` (reusing the card's own title,
          // rather than adding a new translation key outside this task's
          // owned paths) give it an accessible name without introducing a
          // second `region` landmark alongside the section it lives in.
          <div style={s.symbolList} tabIndex={0} role="group" aria-label={t("title")}>
            {/* `totals.callers === 0` only means the caller GRAPH is empty —
                a symbol row still carries its own chips (endpoints/crons
                declared in the changed file itself), which have nothing to
                do with the caller graph. Demote the "no downstream callers"
                fact to a note alongside the rows instead of hiding them. */}
            {totals.callers === 0 && (
              <div style={s.noDownstreamNote}>{t("noDownstream", { count: totals.symbols })}</div>
            )}
            {/* Render only a capped top slice by default (SYMBOL_PAGE) — the
                server already orders `symbols[]` by usefulness, so this is a
                bound on render size, never a client-side sort. Computed
                inline from `symbols`/`showAllSymbols` on every render, not
                stored, so it can never drift from the fetched data. */}
            {(showAllSymbols ? symbols : symbols.slice(0, SYMBOL_PAGE)).map((symbol) => {
              const key = `${symbol.file}:${symbol.name}`;
              return (
                <SymbolRow
                  key={key}
                  symbol={symbol}
                  isExpanded={expanded.has(key)}
                  onToggle={() => toggle(key)}
                  repoFullName={repoFullName}
                  headSha={headSha}
                  t={t}
                />
              );
            })}
            {!showAllSymbols && symbols.length > SYMBOL_PAGE && (
              <button
                type="button"
                style={s.showAllButton}
                onClick={() => setShowAllSymbols(true)}
              >
                {t("showAllSymbols", { count: symbols.length })}
              </button>
            )}
          </div>
        )}

        {/* T8 — always visible under the Tree, per the mockup. REQ-10's data
            already rides in this same `useBlastRadius` response — no second
            hook, no second fetch. */}
        <PriorPrs priorPrs={prior_prs} priorPrsAvailable={coverage.prior_prs_available} />
      </div>
    </section>
  );
}

function StatItem({
  icon,
  label,
  value,
}: {
  icon: "Code" | "CornerDownRight" | "Globe" | "Clock";
  label: string;
  value: string;
}) {
  const I = Icon[icon];
  return (
    <div style={s.statItem}>
      <I size={13} style={s.statIcon} />
      <span className="tnum" style={s.statValue}>
        {value}
      </span>
      <span>{label}</span>
    </div>
  );
}

function SymbolRow({
  symbol,
  isExpanded,
  onToggle,
  repoFullName,
  headSha,
  t,
}: {
  symbol: BlastSymbolImpact;
  isExpanded: boolean;
  onToggle: () => void;
  repoFullName?: string | null;
  headSha?: string | null;
  t: ReturnType<typeof useTranslations>;
}) {
  const { endpoints, crons } = splitChips(symbol.chips);
  const hasChips = endpoints.length > 0 || crons.length > 0;
  const hasCallers = symbol.callers.length > 0;
  // A row with nothing to reveal (no callers AND no chips) must not offer an
  // expand affordance that opens onto an empty void — degrade to a plain,
  // non-interactive row instead of a chevron/toggle that expands into nothing.
  const isExpandable = hasCallers || hasChips;
  const showBody = isExpandable && isExpanded;

  return (
    <div style={s.symbolWrap}>
      <button
        type="button"
        style={s.symbolHeader(isExpandable)}
        onClick={isExpandable ? onToggle : undefined}
        aria-expanded={isExpandable ? isExpanded : undefined}
        disabled={!isExpandable}
      >
        {isExpandable ? (
          <Icon.ChevronDown size={14} style={s.symbolChevron(isExpanded)} />
        ) : (
          <span style={s.symbolChevronSpacer} aria-hidden="true" />
        )}
        <Icon.Code size={13} style={s.symbolIcon} />
        <span className="mono" style={s.symbolName}>
          {symbol.name}
        </span>
        <span className="tnum" style={s.callerBadge}>
          {t("callerCount", { count: symbol.caller_count })}
        </span>
      </button>

      {showBody && (
        <div style={s.symbolBody}>
          {symbol.callers.map((caller) => {
            const href =
              repoFullName && headSha
                ? githubBlobUrl(repoFullName, headSha, caller.file, caller.line)
                : undefined;
            return (
              <div key={`${caller.file}:${caller.line}:${caller.symbol}`} style={s.callerRow}>
                <Icon.CornerDownRight size={12} style={s.callerIcon} />
                <MonoLink href={href}>
                  {caller.file}:{caller.line}
                </MonoLink>
              </div>
            );
          })}

          {/* The list itself can be a truncated prefix (repo-intel caps
              callers per symbol) even though `caller_count` is the honest
              pre-cap total (blast-api.ts's `BlastSymbolImpact.caller_count`
              doc comment) — say so, rather than silently omitting the rest. */}
          {symbol.callers.length < symbol.caller_count && (
            <div style={s.callerTruncatedNote}>
              {t("callerTruncated", { shown: symbol.callers.length, total: symbol.caller_count })}
            </div>
          )}

          {hasChips && (
            <>
              {endpoints.length > 0 && (
                <div style={s.chipRow}>
                  {endpoints.map((chip) => (
                    <span key={`${chip.kind}:${chip.label}:${chip.file}`} style={s.endpointChip}>
                      <Icon.Globe size={12} />
                      {chip.label}
                    </span>
                  ))}
                </div>
              )}
              {crons.length > 0 && (
                <div style={s.chipRow}>
                  {crons.map((chip) => (
                    <span key={`${chip.kind}:${chip.label}:${chip.file}`} style={s.cronChip}>
                      <Icon.Clock size={12} />
                      {chip.label}
                    </span>
                  ))}
                </div>
              )}
              {/* REQ-16: heuristic chips are never presented as certainty. */}
              <div style={s.heuristicNote}>{t("heuristicNote")}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
