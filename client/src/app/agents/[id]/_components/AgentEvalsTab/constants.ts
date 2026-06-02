/** Constants for the Agent "Evals" tab. */

/** Eval-case last-run status → icon + token colour. */
export const STATUS_MAP = {
  pass: { icon: "CheckCircle", color: "var(--ok)" },
  fail: { icon: "XCircle", color: "var(--crit)" },
  never: { icon: "Dot", color: "var(--text-muted)" },
} as const;

export type CaseStatus = keyof typeof STATUS_MAP;
