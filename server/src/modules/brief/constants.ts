/**
 * A3 — brief + git-why module constants (extracted from service.ts / why.ts; no
 * behaviour change).
 */
import type { Provider } from '@devdigest/shared';

/** PR-number extraction from a commit message (squash/merge/inline forms). */
export const PR_NUM_RE = /\(#(\d+)\)|#(\d+)\b|Merge pull request #(\d+)/;

/** Default provider/model for the risk-derivation LLM pass. */
export const RISK_PROVIDER: Provider = 'openai';
export const RISK_MODEL = 'gpt-4.1';

/** System prompt for the risk-derivation pass. */
export const RISK_SYSTEM_PROMPT =
  'You assess the RISKS of a pull request. Identify concrete risks a reviewer should weigh before merging: regressions, security, performance, data-migration, backwards-compat, and operational risks. For each risk give a short kind, a title, a one-paragraph explanation, a severity (high|medium|low), and the files it touches. Be specific and grounded in the diff. Return an empty list if the change is genuinely low-risk.';

/** Heuristic-risk detection patterns + thresholds (no-LLM fallback). */
export const SECRET_RE = /sk_live_|api[_-]?key|secret|password|token\s*=/i;
export const MIGRATION_RE = /migration|schema|\.sql$/i;
export const LARGE_DIFF_LINES = 400;

/** Cap on prior-PR history items + spec chunks pulled per brief. */
export const MAX_HISTORY_ITEMS = 5;
export const SPEC_CHUNK_LIMIT = 6;

/** Structured-completion retry budget for the risk pass. */
export const RISK_MAX_RETRIES = 1;
