import type { TrifectaComponent } from '@devdigest/shared';

/**
 * A5 — runs module constants (extracted from service/curator/trifecta).
 * No behaviour change: these are the literals the module already used.
 */

// ---- Multi-Agent assembly (service.ts) -------------------------------------

/** Grace window (ms) subtracted from a multi-agent run's ranAt when collecting
 *  member agent_runs — absorbs clock skew between the INSERT and member rows. */
export const MEMBER_RUN_GRACE_MS = 2000;

/** How many trailing runs feed the per-agent findings-per-run trend. */
export const TREND_WINDOW = 12;

// ---- Memory curator (curator.ts) -------------------------------------------

/** Default cosine-similarity threshold for clustering near-duplicate memory. */
export const DEFAULT_SIMILARITY = 0.92;

/** Confidence floor applied to a kept (merged) memory row. */
export const KEPT_CONFIDENCE_FLOOR = 0.85;

/** Fallback confidence used when a kept row has none. */
export const KEPT_CONFIDENCE_FALLBACK = 0.7;

// ---- Lethal-Trifecta detector (trifecta.ts) --------------------------------

/** Display name for the built-in detector's runs / traces. */
export const TRIFECTA_AGENT_NAME = 'Lethal-Trifecta';

/** Max characters of a matched diff line captured as snippet evidence. */
export const SNIPPET_MAX_LEN = 200;

/** Regex patterns for the three trifecta legs (scanned over added diff lines). */
export const TRIFECTA_PATTERNS: { component: TrifectaComponent; re: RegExp }[] = [
  {
    component: 'private_data_access',
    re: /(api[_-]?key|secret|token|password|credential|process\.env|private[_-]?key|authorization|bearer)/i,
  },
  {
    component: 'untrusted_input',
    re: /(req\.(body|query|params)|request\.(body|query|params)|callback_url|webhook|payload|untrusted|user[_-]?input|searchParams)/i,
  },
  {
    component: 'exfil_path',
    re: /(fetch\(|axios\.|https?\.request|got\(|\.post\(|sendmail|outbound|exec\(|child_process|\.upload\()/i,
  },
];

/** Canonical order the three legs are emitted as evidence. */
export const TRIFECTA_LEG_ORDER: readonly TrifectaComponent[] = [
  'private_data_access',
  'untrusted_input',
  'exfil_path',
];

/** Conflict rationale/note truncation length (conflicts.ts). */
export const CONFLICT_NOTE_MAX_LEN = 160;
