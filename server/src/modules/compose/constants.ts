import type { Verdict } from '@devdigest/shared';

/** Map a DevDigest verdict to the GitHub review event. */
export const VERDICT_EVENT: Record<Verdict, 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'> = {
  approve: 'APPROVE',
  request_changes: 'REQUEST_CHANGES',
  comment: 'COMMENT',
};

/** Severity → emoji used in the composed review body. */
export const SEV_EMOJI: Record<string, string> = {
  CRITICAL: '🔴',
  WARNING: '🟡',
  SUGGESTION: '🔵',
};
