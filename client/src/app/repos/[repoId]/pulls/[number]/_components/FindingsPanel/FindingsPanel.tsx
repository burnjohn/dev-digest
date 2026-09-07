/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import type { FindingCardAction } from "../FindingCard";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "../FindingCard/constants";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import {
  useCreateEvalCaseFromFinding,
  useCreateSkillEvalCaseFromFinding,
  useFindingEvalSkills,
} from "../../../../../../../lib/hooks/eval";
import { useToast } from "../../../../../../../lib/toast";
import { ApiError } from "../../../../../../../lib/api";
import { KEY_TO_ACTION } from "./constants";
import { visibleFindings, countBySeverity, bySeverity } from "./helpers";
import { s } from "./styles";

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
  targetFindingId = null,
  targetFindingNonce = 0,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  /** Smart Diff → Findings navigation — when set, that finding's card gets
   *  keyboard focus, expands, and scrolls into view (ReviewRunAccordion's
   *  own open/scroll already got this panel on-screen). */
  targetFindingId?: string | null;
  targetFindingNonce?: number;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const createEvalCase = useCreateEvalCaseFromFinding();
  const createSkillEvalCase = useCreateSkillEvalCaseFromFinding();
  const toast = useToast();
  const [hideLow, setHideLow] = React.useState(false);
  const [severity, setSeverity] = React.useState<string | null>(null);
  const [focusIdx, setFocusIdx] = React.useState(0);

  // AC-2 — the skill offer list is fetched lazily, one finding at a time:
  // opening a finding's "turn into skill eval case" menu sets this to that
  // finding's id, which is the only thing that ever makes `useFindingEvalSkills`
  // fire a GET (client/CLAUDE.md — reads never trigger work on their own here).
  const [skillMenuFindingId, setSkillMenuFindingId] = React.useState<string | null>(null);
  const { data: skillOffers, isLoading: skillOffersLoading } = useFindingEvalSkills(skillMenuFindingId);

  // Counts come from the post-hide-low list, so a chip's number always equals
  // the number of cards you get when you click it.
  const visible = React.useMemo(() => visibleFindings(findings, hideLow), [findings, hideLow]);
  const counts = React.useMemo(() => countBySeverity(visible), [visible]);
  const shown = React.useMemo(() => bySeverity(visible, severity), [visible, severity]);

  // A narrower list can't keep the old focus — it may now point past the end.
  React.useEffect(() => setFocusIdx(0), [severity, hideLow]);

  // Smart Diff navigation moves keyboard focus (j/k) to the target finding too,
  // so accept/dismiss shortcuts act on it right after the jump.
  React.useEffect(() => {
    if (!targetFindingId) return;
    const idx = shown.findIndex((f) => f.id === targetFindingId);
    if (idx >= 0) setFocusIdx(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFindingId, targetFindingNonce]);

  const toggleSeverity = React.useCallback(
    (sev: string) => setSeverity((cur) => (cur === sev ? null : sev)),
    [],
  );

  // AC-2/AC-1 — "turn into eval case" is a DIFFERENT endpoint than
  // accept/dismiss/learn/reply, so it branches here rather than joining
  // `useFindingAction`'s `FindingActionKind` mutation. The idempotent path
  // (D17 — a case already exists for this finding) gets its own toast
  // copy, never "created".
  const handleAction = React.useCallback(
    (findingId: string, act: FindingCardAction) => {
      if (act === "turnIntoEvalCase") {
        createEvalCase.mutate(findingId, {
          onSuccess: ({ created }) => {
            toast.success(created ? t("finding.turnIntoEvalCaseCreated") : t("finding.turnIntoEvalCaseExists"));
          },
          onError: (err) => {
            toast.error(err instanceof ApiError ? err.message : t("finding.turnIntoEvalCaseError"));
          },
        });
        return;
      }
      // specs/13-multi-agent-review.md AC-63..65 — Learn has no visible
      // triage-state change on the card (unlike accept/dismiss), so it needs
      // its own toast to confirm the write happened at all. Copy must say the
      // finding was RECORDED as a note, never that an agent "learned" from it.
      if (act === "learn") {
        action.mutate(
          { findingId, action: "learn", prId },
          {
            onSuccess: () => toast.success(t("finding.learnRecorded")),
            onError: (err) => toast.error(err instanceof ApiError ? err.message : t("finding.learnError")),
          },
        );
        return;
      }
      action.mutate({ findingId, action: act, prId });
    },
    [action, createEvalCase, prId, t, toast],
  );

  // specs/15-skill-eval-cases.md AC-1, AC-2, D10 — the skill-owned sibling
  // of `handleAction`'s "turnIntoEvalCase" branch, driven by
  // `SkillEvalMenu`'s own offer list rather than `FindingCardAction`
  // (offers are per-skill, not a single fixed action id).
  const handleSkillEvalCase = React.useCallback(
    (findingId: string, skillId: string) => {
      createSkillEvalCase.mutate(
        { findingId, skillId },
        {
          onSuccess: ({ created }) => {
            toast.success(created ? t("finding.turnIntoEvalCaseCreated") : t("finding.turnIntoEvalCaseExists"));
          },
          onError: (err) => {
            toast.error(err instanceof ApiError ? err.message : t("finding.turnIntoEvalCaseError"));
          },
        },
      );
    },
    [createSkillEvalCase, t, toast],
  );

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, action, prId]);

  return (
    <div>
      <div style={s.toolbar}>
        {counts.map(({ severity: sev, count }) => {
          const active = severity === sev;
          const color = SEV_COLOR[sev] ?? SEV_COLOR_FALLBACK;
          return (
            <button
              key={sev}
              type="button"
              aria-pressed={active}
              title={active ? t("panel.clearFilter") : t("panel.filterBySeverity", { severity: sev })}
              onClick={() => toggleSeverity(sev)}
              style={s.severityChip(color, active)}
            >
              {count} {sev}
            </button>
          );
        })}
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focusIdx}
              defaultExpanded={i === 0}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              targetFindingId={targetFindingId}
              targetFindingNonce={targetFindingNonce}
              onAction={(act) => handleAction(f.id, act)}
              skillEvalOffers={skillMenuFindingId === f.id ? skillOffers : undefined}
              skillEvalOffersLoading={skillMenuFindingId === f.id && skillOffersLoading}
              onOpenSkillEvalOffers={() => setSkillMenuFindingId(f.id)}
              onSkillEvalCase={(skillId) => handleSkillEvalCase(f.id, skillId)}
            />
          ))
        )}
      </div>
    </div>
  );
}
