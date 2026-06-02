/** Constants for the weekly digest module. */

/** Default digest window length in milliseconds (7 days). */
export const DIGEST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Severity buckets tallied in the digest (in display order). */
export const SEVERITY_KEYS = ['CRITICAL', 'WARNING', 'SUGGESTION'] as const;

/** Job name registered for scheduled digest builds. */
export const WEEKLY_DIGEST_JOB = 'weekly_digest';
