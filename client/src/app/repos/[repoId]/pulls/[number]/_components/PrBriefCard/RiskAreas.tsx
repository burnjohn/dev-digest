/* RiskAreas — the `RISK AREAS` half of the brief, rendered INSIDE IntentCard's
   card, below the IN SCOPE / OUT OF SCOPE grid and a divider (AC-26, reworked
   2026-08-26; both mockups draw it in the same bordered box as the scope
   lists, and the owner reversed the earlier separate-card decision).

   Deliberately NOT a card: no SectionLabel, no border, no `bg-elevated` box.
   A bordered box nested inside IntentCard's own card would read as a second
   card and undo the whole point of the move. The one thing it owns is the
   small-caps `RISK AREAS` label, styled to match IntentCard's own
   `scopeLabel`.

   It reads `usePrBrief` itself rather than taking the brief as a prop:
   PrBriefCard (the band) mounts the same query, TanStack Query dedupes on
   `["pr-brief", prId]`, and IntentCard stays ignorant of the brief entirely —
   it just renders whatever child OverviewTab hands it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Skeleton } from "@devdigest/ui";
import type { RiskBriefArea } from "@devdigest/shared";
import { usePrBrief } from "@/lib/hooks/brief";
import { RISK } from "./constants";
import { riskFileHref } from "./helpers";
import { s } from "./styles";

interface RiskAreasProps {
  prId: string | null;
  /** Both nullable and passed through un-narrowed: a row whose link cannot be
      built renders its path as plain text, never a github.com URL made from a
      uuid (client/INSIGHTS.md 2026-08-17). */
  repoFullName?: string | null;
  headSha?: string | null;
}

/** Not a REQ-relevant identity, just a stable-enough key/id anchor for a
    given render — combines the two fields the contract actually requires
    (`title`, `file`) rather than reaching for the array index (never a valid
    React key, and unusable as a stable id across the single-open toggle). */
function riskKey(risk: RiskBriefArea): string {
  return `${risk.file}::${risk.title}`;
}

export function RiskAreas({ prId, repoFullName, headSha }: RiskAreasProps) {
  const t = useTranslations("riskBrief");
  const { data: brief, isLoading, isError, refetch } = usePrBrief(prId);
  // Single open row at a time (REQ-28) — a `string | null`, never a `Set`.
  const [openRisk, setOpenRisk] = React.useState<string | null>(null);

  if (!prId) return null;

  const label = (
    <div style={s.risksLabel}>
      <Icon.AlertTriangle size={13} style={s.risksLabelIcon} />
      <span>{t("risks.title")}</span>
    </div>
  );

  if (isLoading) {
    return (
      <div style={s.riskSection}>
        {label}
        <Skeleton height={13} width="70%" />
        <Skeleton height={13} width="55%" style={{ marginTop: 8 }} />
      </div>
    );
  }

  // Transport failures only — a malformed payload throws in the destructuring
  // below and is caught by the ErrorBoundary OverviewTab wraps this in
  // (client/INSIGHTS.md 2026-08-25). That boundary is this section's alone, so
  // a bad brief costs the risk list and not IntentCard's own content.
  if (isError || !brief) {
    return (
      <div style={s.riskSection}>
        {label}
        <div role="alert" style={s.errorRow}>
          <span>{t("error")}</span>
          <button type="button" style={s.retryButton} onClick={() => refetch()}>
            {t("retry")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.riskSection}>
      {label}
      {/* The empty state REPLACES the list only — the band above still shows
          what/why and the risk-level badge (REQ-30/AC-30). */}
      {brief.risks.length === 0 ? (
        <div style={s.empty}>{t("risks.empty")}</div>
      ) : (
        <div style={s.riskList} role="group" aria-label={t("risks.title")}>
          {brief.risks.map((risk) => {
            const key = riskKey(risk);
            return (
              <RiskRow
                key={key}
                risk={risk}
                href={riskFileHref(repoFullName, headSha, risk.file)}
                isOpen={openRisk === key}
                onToggle={() => setOpenRisk((prev) => (prev === key ? null : key))}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function RiskRow({
  risk,
  href,
  isOpen,
  onToggle,
}: {
  risk: RiskBriefArea;
  href: string | undefined;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const level = RISK[risk.severity];
  const SeverityIcon = Icon[level.icon];
  // Inline styles can't express `:hover`, so the link tracks it in state —
  // the same shape ReviewFocusCard's `FocusRow` uses.
  const [hovered, setHovered] = React.useState(false);
  // Stable per mounted row, independent of list order — `React.useId` rather
  // than an array index, since AC-34 needs a real id for `aria-controls`.
  const regionId = `pr-brief-risk-${React.useId()}`;

  return (
    <div style={s.riskWrap}>
      {/* The disclosure trigger is the TITLE row only. The file path is a
          SIBLING, never a child: an `<a>` inside a `<button>` is nested
          interactive content — the parser breaks it apart and the inner
          control drops out of the tab order (client/INSIGHTS.md 2026-08-16).
          That is the whole reason this row is not one two-line button any
          more. */}
      <button
        type="button"
        style={s.riskHeader}
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={regionId}
      >
        <SeverityIcon size={14} style={s.riskIcon(level.c)} />
        <span style={s.riskTitle}>{risk.title}</span>
        <Icon.ChevronDown size={14} style={s.riskChevron(isOpen)} />
      </button>
      <div style={s.riskFileRow}>
        {/* Links to the file at the PR's head with NO line fragment (REQ-13),
            and degrades to plain text rather than a broken github.com URL when
            `repoFullName`/`headSha` is missing — same contract as
            ReviewFocusCard's rows. */}
        {href ? (
          <a
            className="mono"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={risk.file}
            translate="no"
            style={s.fileLink(hovered)}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            {risk.file}
          </a>
        ) : (
          <span className="mono" style={s.filePlain} title={risk.file} translate="no">
            {risk.file}
          </span>
        )}
      </div>
      {/* The region stays in the DOM (hidden) rather than unmounting, so
          `aria-controls` above always points at a real element — only its
          CONTENT is conditional, which is what satisfies REQ-28's "no
          explanation text is in the document" for a collapsed row without
          leaving `aria-controls` dangling at a non-existent id. */}
      <div id={regionId} style={isOpen ? s.riskBody : s.riskBodyHidden}>
        {isOpen && <p style={s.riskExplanation}>{risk.explanation}</p>}
      </div>
    </div>
  );
}
