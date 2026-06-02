import type { CaseStatus } from "./constants";

type LastRun = { pass: boolean | null; recall: number | null } | null | undefined;

/** Resolve an eval case's last-run status bucket. */
export function caseStatus(lastRun: LastRun): CaseStatus {
  if (lastRun == null) return "never";
  return lastRun.pass ? "pass" : "fail";
}
