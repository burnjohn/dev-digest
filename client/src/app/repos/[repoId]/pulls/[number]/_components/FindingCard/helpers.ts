import type { FindingRecord } from "@devdigest/shared";

/** Format a finding's line range ("11" when single-line, else "11-15"). */
export function lineLabel(f: Pick<FindingRecord, "start_line" | "end_line">): string {
  return f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
}

/** The `messages/en/eval.json` `turnIntoCase.*` key for a disabled action's
 * reason, or `null` when the action is enabled. */
export type TurnIntoCaseReasonKey = "disabledUndecided" | "disabledNoDiff";

export interface TurnIntoCaseState {
  disabled: boolean;
  reasonKey: TurnIntoCaseReasonKey | null;
}

/**
 * REQ-1/2/3: the "Turn into eval case" action's enabled/disabled state.
 * `draftAvailable` reflects `useFindingEvalDraft`'s `isSuccess` — the ONLY
 * source of truth for "a stored diff exists" (T11's `409` is server-side; a
 * finding record carries no such field, so this can never be decided from
 * `f` alone). An undecided finding never even fires that query (REQ-2), so
 * `draftAvailable` is irrelevant until the finding is accepted or dismissed;
 * while the query is still loading or has errored, the action stays
 * disabled with the "no stored diff" reason — the closest available
 * accessible-name fallback for "not yet known to be available".
 */
export function turnIntoCaseState(params: {
  accepted: boolean;
  dismissed: boolean;
  draftAvailable: boolean;
}): TurnIntoCaseState {
  if (!params.accepted && !params.dismissed) {
    return { disabled: true, reasonKey: "disabledUndecided" };
  }
  if (params.draftAvailable) {
    return { disabled: false, reasonKey: null };
  }
  return { disabled: true, reasonKey: "disabledNoDiff" };
}

/** The `messages/en/prReview.json` `finding.*` key explaining why the opposite
 * decision is unavailable, or `null` when it is available. */
export type DecisionBlockedReasonKey = "disabledAccepted" | "disabledDismissed";

export interface DecisionState {
  /** Accept is unavailable — a dismissal stands and must be reverted first. */
  acceptDisabled: boolean;
  /** Dismiss is unavailable — an acceptance stands and must be reverted first. */
  dismissDisabled: boolean;
  acceptReasonKey: DecisionBlockedReasonKey | null;
  dismissReasonKey: DecisionBlockedReasonKey | null;
  /** The revert control renders only once a decision actually stands. */
  revertVisible: boolean;
}

/**
 * The accept/dismiss/revert action row's state.
 *
 * A standing decision LOCKS the opposite action: `accept -> dismiss` is not a
 * transition the UI offers, even though the API would still perform it (see
 * `server/src/modules/reviews/findings.ts`). The only way across is
 * `accept -> revert -> dismiss`, which makes undoing a decision a deliberate,
 * visible step rather than a mis-click on the neighbouring button.
 *
 * Both flags true is unreachable from the API — `accepted_at` and
 * `dismissed_at` are mutually exclusive on write — but a drifted payload is
 * handled rather than trusted: it locks BOTH actions and still offers revert,
 * which is the state a user can actually get out of.
 */
export function decisionState(params: { accepted: boolean; dismissed: boolean }): DecisionState {
  const { accepted, dismissed } = params;
  return {
    acceptDisabled: dismissed,
    dismissDisabled: accepted,
    acceptReasonKey: dismissed ? "disabledDismissed" : null,
    dismissReasonKey: accepted ? "disabledAccepted" : null,
    revertVisible: accepted || dismissed,
  };
}
