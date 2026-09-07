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
import type { EvalSkillOffer } from "@devdigest/shared/contracts/eval-ci";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { lineLabel } from "./helpers";
import { githubBlobUrl } from "../../../../../../../lib/github-urls";
import { SkillEvalMenu } from "./SkillEvalMenu";
import { s } from "./styles";

/**
 * specs/12-eval-pipeline.md AC-2 — "turn into eval case" is a THIRD action,
 * threaded through the same `onAction` prop chain accept/dismiss already use
 * rather than a new bespoke callback. It is deliberately NOT part of the
 * shared `FindingActionKind` contract (that enum backs `POST
 * /findings/:id/:action`, a different route than the eval-case one) — the
 * caller (`FindingsPanel`) branches on this value and calls a different
 * mutation for it.
 */
export type FindingCardAction = FindingActionKind | "turnIntoEvalCase";

export function FindingCard({
  f,
  focused,
  defaultExpanded,
  onAction,
  pending,
  repoFullName,
  headSha,
  targetFindingId,
  targetFindingNonce,
  skillEvalOffers,
  skillEvalOffersLoading,
  onOpenSkillEvalOffers,
  onSkillEvalCase,
}: {
  f: FindingRecord;
  focused?: boolean;
  defaultExpanded?: boolean;
  onAction?: (action: FindingCardAction, reply?: string) => void;
  pending?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
  /** Smart Diff → Findings navigation: when this matches `f.id`, the card
   *  expands and smooth-scrolls into view. `targetFindingNonce` re-triggers
   *  the scroll on a repeat click of the same finding's badge. */
  targetFindingId?: string | null;
  targetFindingNonce?: number;
  /**
   * specs/15-skill-eval-cases.md AC-1, AC-2 — the skill-owned sibling of
   * "turn into eval case". `skillEvalOffers` is `undefined` until
   * `onOpenSkillEvalOffers` has fired at least once (FindingsPanel fetches
   * lazily, one finding's offers at a time — see its own hook wiring).
   */
  skillEvalOffers?: EvalSkillOffer[];
  skillEvalOffersLoading?: boolean;
  onOpenSkillEvalOffers?: () => void;
  onSkillEvalCase?: (skillId: string) => void;
}) {
  const t = useTranslations("prReview");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const isTarget = targetFindingId != null && targetFindingId === f.id;
  React.useEffect(() => {
    if (!isTarget) return;
    setExpanded(true);
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFindingId, targetFindingNonce]);
  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;
  const fileHref =
    repoFullName && headSha
      ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;

  return (
    <div ref={rootRef} data-finding-id={f.id} style={s.card(!!focused || isTarget, sevColor, muted)}>
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
            {/* specs/13-multi-agent-review.md D25 — Learn is deliberately NOT
                gated behind triage state (unlike "turn into eval case" below):
                it records a repo-scoped note from the finding as-is, so it
                appears on every finding here and on the multi-agent results
                tab alike. */}
            <Button
              kind="ghost"
              size="sm"
              icon="Brain"
              disabled={pending}
              onClick={() => onAction?.("learn")}
            >
              {t("finding.learn")}
            </Button>
            {/* AC-2: only once this finding has been triaged — the server
                refuses the untriaged case too, but hiding it here saves the
                round trip and the confusing 422. */}
            {muted && (
              <Button
                kind="ghost"
                size="sm"
                icon="ListChecks"
                disabled={pending}
                onClick={() => onAction?.("turnIntoEvalCase")}
              >
                {t("finding.turnIntoEvalCase")}
              </Button>
            )}
            {muted && onSkillEvalCase && (
              <SkillEvalMenu
                offers={skillEvalOffers}
                loading={!!skillEvalOffersLoading}
                disabled={pending}
                onOpen={() => onOpenSkillEvalOffers?.()}
                onSelect={onSkillEvalCase}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
