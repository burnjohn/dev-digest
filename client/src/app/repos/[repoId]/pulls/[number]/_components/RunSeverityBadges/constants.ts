/**
 * Badge counts include dismissed findings on purpose: the badges are a grouping
 * of what the run PRODUCED, so the sum matches the stored `findings_count` and
 * the row's outcome color (both computed at run completion, never updated by
 * triage). Flip to false to show the post-triage "live" state instead — but
 * then the sum can disagree with the row's status badge.
 */
export const COUNT_DISMISSED = true;

/** Max findings listed in the hover popover before the "+N more" footer. */
export const POPOVER_CAP = 5;
