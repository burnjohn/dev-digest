/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, accept/dismiss/revert actions. Accept/dismiss reflect persisted
   timestamps; a standing decision disables the opposite action and exposes a
   revert control beside itself. */
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
import { REVERT_ICON, SEV_COLOR, SEV_COLOR_FALLBACK, TURN_INTO_CASE_ICON } from "./constants";
import { decisionState, lineLabel, turnIntoCaseState } from "./helpers";
import { githubBlobUrl } from "../../../../../../../lib/github-urls";
import { useFindingEvalDraft } from "@/lib/hooks/evals";
import { EvalCaseEditor } from "@/components/eval-case-editor";
import { s } from "./styles";

/**
 * T15 — REQ-1/2/3: the "Turn into eval case" action, plus its editor.
 * FindingCard is mounted deep inside every findings list
 * (FindingsPanel/FindingsTab/ReviewRunAccordion), all of which sit under the
 * app-wide `QueryClientProvider` from `client/src/lib/providers.tsx` — this
 * action runs its query and mutations (`useFindingEvalDraft`,
 * `useCreateEvalCase`/`useUpdateEvalCase` inside `EvalCaseEditor`) against
 * that SAME client (FIX-4), so a case created here invalidates the ["evals",
 * …] keys the Evals dashboard actually reads, not a private cache nobody
 * else sees. Never a `fetch` in the component either — `useFindingEvalDraft`
 * still owns the request via `lib/api.ts`. */
function TurnIntoCaseAction({
  f,
  pending,
  accepted,
  dismissed,
}: {
  f: FindingRecord;
  pending?: boolean;
  accepted: boolean;
  dismissed: boolean;
}) {
  const tTurnIntoCase = useTranslations("eval.turnIntoCase");
  const [caseEditorOpen, setCaseEditorOpen] = React.useState(false);
  const muted = accepted || dismissed;

  /* REQ-1/2/3: fetch the eval-case draft once the finding is decided, so the
     action's enabled/disabled state is already known BEFORE the user clicks
     it (REQ-3's "renders it disabled" is a render-time fact, not a
     click-time discovery) — an undecided finding never fires this at all.
     `EvalCaseDraft` is never synthesized client-side; T11's `409` (no
     stored diff, no agent_id, or not decided) is read through this query's
     `isError`, never re-derived from `f`. */
  // `decidedAs` keys the draft by the decision it was built from — the server
  // stamps `seeded_from` from `accepted_at`/`dismissed_at`, so a finding that
  // is accepted, reverted, then dismissed must NOT reuse the accept-time
  // draft's cache entry (it would open a POSITIVE editor for a dismissed
  // finding). Reverting to undecided disables the query, and its `null`
  // decision is a third key that is never fetched.
  const draftQuery = useFindingEvalDraft(f.id, {
    enabled: muted,
    decidedAs: accepted ? "accepted" : dismissed ? "dismissed" : null,
  });
  const turnIntoCase = turnIntoCaseState({ accepted, dismissed, draftAvailable: draftQuery.isSuccess });
  const turnIntoCaseAccessibleName = turnIntoCase.reasonKey
    ? `${tTurnIntoCase("label")} — ${tTurnIntoCase(turnIntoCase.reasonKey)}`
    : undefined;

  return (
    <>
      <Button
        kind="ghost"
        size="sm"
        icon={TURN_INTO_CASE_ICON}
        disabled={pending || turnIntoCase.disabled}
        aria-label={turnIntoCaseAccessibleName}
        title={turnIntoCase.reasonKey ? tTurnIntoCase(turnIntoCase.reasonKey) : undefined}
        onClick={() => {
          if (turnIntoCase.disabled) return;
          setCaseEditorOpen(true);
        }}
      >
        {tTurnIntoCase("label")}
      </Button>

      {caseEditorOpen && draftQuery.data && (
        <EvalCaseEditor
          ownerKind={draftQuery.data.owner_kind}
          ownerId={draftQuery.data.owner_id}
          initialCase={draftQuery.data}
          onClose={() => setCaseEditorOpen(false)}
        />
      )}
    </>
  );
}

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

  // Accept/dismiss/revert availability. `decisionState` is pure and lives in
  // `helpers.ts` so the "one decision locks the other" rule is asserted
  // directly, not only through a rendered button's `disabled` attribute.
  const decision = decisionState({ accepted, dismissed });
  // A disabled control still needs to say WHY: `title` alone is a hover-only
  // affordance, so the reason also goes into the accessible name. When the
  // action is available the name stays the plain label (`aria-label`
  // undefined), which is what the existing `getByRole("button", { name:
  // "Accept" })` queries read.
  const acceptName = decision.acceptReasonKey
    ? `${t("finding.accept")} — ${t(`finding.${decision.acceptReasonKey}`)}`
    : undefined;
  const dismissName = decision.dismissReasonKey
    ? `${t("finding.dismiss")} — ${t(`finding.${decision.dismissReasonKey}`)}`
    : undefined;
  // Icon-only, so its accessible name comes entirely from `aria-label`
  // (client/INSIGHTS.md 2026-08-16: a `vendor/ui` control has no name by
  // default). Rendered once, placed next to whichever decision stands.
  const revertButton = decision.revertVisible ? (
    <Button
      kind="ghost"
      size="sm"
      icon={REVERT_ICON}
      disabled={pending}
      aria-label={accepted ? t("finding.revertAccepted") : t("finding.revertDismissed")}
      title={t("finding.revert")}
      onClick={() => onAction?.("revert")}
    />
  ) : null;

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

          {/* A standing decision locks the OPPOSITE action — the only way from
              accepted to dismissed is through the revert control that appears
              next to whichever decision was taken (`decisionState`). The
              disabled button keeps rendering rather than disappearing: the row
              must still show that "Dismiss" is a thing this finding has, and
              why it is currently unavailable (`title` + accessible name). */}
          <div style={s.actions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={pending || decision.acceptDisabled}
              active={accepted}
              aria-label={acceptName}
              title={decision.acceptReasonKey ? t(`finding.${decision.acceptReasonKey}`) : undefined}
              onClick={() => {
                if (decision.acceptDisabled) return;
                onAction?.("accept");
              }}
            >
              {t("finding.accept")}
            </Button>
            {accepted && revertButton}
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={pending || decision.dismissDisabled}
              active={dismissed}
              aria-label={dismissName}
              title={decision.dismissReasonKey ? t(`finding.${decision.dismissReasonKey}`) : undefined}
              onClick={() => {
                if (decision.dismissDisabled) return;
                onAction?.("dismiss");
              }}
            >
              {t("finding.dismiss")}
            </Button>
            {dismissed && !accepted && revertButton}
            <TurnIntoCaseAction f={f} pending={pending} accepted={accepted} dismissed={dismissed} />
          </div>
        </div>
      )}
    </div>
  );
}
