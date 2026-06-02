/** Constants for the CI Runs view. */

/** Status → token colours + i18n key for the run status badge. */
export const STATUS: Record<string, { c: string; bg: string; labelKey: string }> = {
  succeeded: { c: "var(--ok)", bg: "var(--ok-bg)", labelKey: "runs.status.succeeded" },
  no_findings: { c: "var(--text-secondary)", bg: "var(--bg-hover)", labelKey: "runs.status.noFindings" },
  failed: { c: "var(--crit)", bg: "var(--crit-bg)", labelKey: "runs.status.failed" },
  running: { c: "var(--warn)", bg: "var(--warn-bg)", labelKey: "runs.status.running" },
};

/** Runs table column template. */
export const COLS = "150px 1fr 150px 120px 90px 110px 90px";
