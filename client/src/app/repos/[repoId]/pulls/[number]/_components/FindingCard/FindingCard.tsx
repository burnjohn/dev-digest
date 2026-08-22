/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, accept/dismiss actions. Accept/dismiss reflect persisted
   timestamps. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Button,
  Markdown,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord, FindingActionKind } from "@devdigest/shared";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { lineLabel } from "./helpers";
import { githubBlobUrl } from "../../../../../../../lib/github-urls";
import { s } from "./styles";

export function FindingCard({
  f,
  focused,
  defaultExpanded,
  onAction,
  pending,
  repoFullName,
  headSha,
  highlighted,
  highlightNonce,
}: {
  f: FindingRecord;
  focused?: boolean;
  defaultExpanded?: boolean;
  onAction?: (action: FindingActionKind, reply?: string) => void;
  pending?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
  /** REQ-18: this is the deep-link's landing target — expand, scroll into
   *  view, and show a ~2s highlight. `highlightNonce` re-fires the effect on
   *  a repeat click even when `highlighted` was already true (mirrors
   *  ReviewRunAccordion's targetRunId/targetNonce pattern, §5.4). */
  highlighted?: boolean;
  highlightNonce?: number;
}) {
  const t = useTranslations("prReview");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const [showHighlight, setShowHighlight] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;
  const fileHref =
    repoFullName && headSha
      ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;

  // REQ-34, cause 2: expand + highlight here, but do NOT scroll in this same
  // effect body — `setExpanded(true)` doesn't take effect until the NEXT
  // render, so a scroll issued right here would measure the COLLAPSED card
  // and land short. The scroll is a separate effect below, keyed on
  // `expanded` itself, so it only runs once the expanded body has actually
  // committed to the DOM.
  React.useEffect(() => {
    if (!highlighted) return;
    setExpanded(true);
    setShowHighlight(true);
    const timer = setTimeout(() => setShowHighlight(false), 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlighted, highlightNonce]);

  // REQ-34: issue the scroll once the card has actually expanded — never on
  // every render while `expanded` stays true (this effect's deps only change
  // when `highlighted`/`highlightNonce` move, or when `expanded` itself
  // flips false→true from the effect above). jsdom has no scrollIntoView
  // implementation — guard the call itself (not just `rootRef.current`) so
  // tests never crash on this.
  React.useEffect(() => {
    if (!highlighted || !expanded) return;
    rootRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlighted, highlightNonce, expanded]);

  // The ~2s deep-link highlight (REQ-18) overrides `boxShadow` only — never
  // `borderColor`, which conflicts with the `borderLeftColor` accent
  // `s.card` already sets (client/INSIGHTS.md 2026-08-10). Computed here
  // rather than inside `styles.ts` — this task does not own that file.
  const cardStyle = s.card(!!focused, sevColor, muted);
  if (showHighlight) cardStyle.boxShadow = "0 0 0 2px var(--accent)";

  return (
    <div
      ref={rootRef}
      data-finding-id={f.id}
      data-highlighted={showHighlight ? "true" : undefined}
      style={cardStyle}
    >
      <div onClick={() => setExpanded((e) => !e)} style={s.header}>
        <div style={s.badgeWrap}>
          <SeverityBadge severity={f.severity as Severity} compact />
        </div>
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <span style={s.title(muted, dismissed)}>{f.title}</span>
            <CategoryTag category={f.category as Category} />
            {accepted && <span style={s.acceptedTag}>{t("finding.accepted")}</span>}
            {dismissed && <span style={s.dismissedTag}>{t("finding.dismissed")}</span>}
          </div>
          <div style={s.metaRow}>
            <MonoLink href={fileHref}>
              {f.file}:{lineLabel(f)}
            </MonoLink>
            <ConfidenceNum value={f.confidence} />
          </div>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{f.rationale}</Markdown>
          </div>
          {f.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{f.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={pending}
              active={accepted}
              onClick={() => onAction?.("accept")}
            >
              {t("finding.accept")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={pending}
              active={dismissed}
              onClick={() => onAction?.("dismiss")}
            >
              {t("finding.dismiss")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
