/**
 * Cron badge labelling — shared by the Tree (SymbolImpact) and Graph
 * (BlastGraph) views so a cron reads identically in both, e.g. `app (every 15
 * min)` rather than the raw five-field cron expression.
 */

/** Common cron cadences → readable suffix; unknown exprs contribute no suffix. */
const CRON_CADENCE: Record<string, string> = {
  "* * * * *": "every minute",
  "*/5 * * * *": "every 5 min",
  "*/15 * * * *": "every 15 min",
  "*/30 * * * *": "every 30 min",
  "0 * * * *": "hourly",
  "0 0 * * *": "daily",
};

/** `foo/bar/reset-buckets.ts` → `reset-buckets` */
function fileLabel(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.[^.]+$/, "");
}

/**
 * Cron badge label — a NAME, not the raw expression:
 *  - `job:<kind>` → the kind (e.g. "poll_repo")
 *  - otherwise → the declaring file's name, with the cadence in parens when
 *    recognised: `reset-buckets (hourly)`. Falls back to the raw expr only when
 *    no source file is known.
 */
export function formatCron(cr: string, files?: string[]): string {
  if (cr.startsWith("job:")) return cr.slice(4);
  const cadence = CRON_CADENCE[cr];
  const src = files?.[0];
  if (src) return cadence ? `${fileLabel(src)} (${cadence})` : fileLabel(src);
  return cadence ?? cr;
}
