/** Constants for FindingCard. */

/** Severity → CSS colour token. */
export const SEV_COLOR: Record<string, string> = {
  CRITICAL: "var(--crit)",
  WARNING: "var(--warn)",
  SUGGESTION: "var(--sugg)",
  INFO: "var(--info)",
};

/** Fallback colour for an unknown severity. */
export const SEV_COLOR_FALLBACK = "var(--text-muted)";

/** `@devdigest/ui` icon key for the "Turn into eval case" action (T15). */
export const TURN_INTO_CASE_ICON = "FlaskConical" as const;

/** `@devdigest/ui` icon key for the icon-only "revert this decision" action.
 *  A back-pointing corner arrow: the decision row reads left-to-right, and this
 *  sends the finding back to where it started. */
export const REVERT_ICON = "CornerUpLeft" as const;
