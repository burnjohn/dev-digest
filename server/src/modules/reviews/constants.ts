/**
 * Review module constants.
 */
import { z } from 'zod';
import { RiskLevel, RiskSeverity } from '@devdigest/shared';

/**
 * Studio review strategy. 'single-pass' = send the WHOLE diff in ONE LLM call.
 * We deliberately do NOT use 'auto'/map-reduce by default: map-reduce makes one
 * call PER FILE, which is slow and fragile (any single file's transient 5xx
 * fails the entire run) and unnecessary — the whole diff already fits the
 * model's context.
 */
export const REVIEW_STRATEGY = 'single-pass' as const;

// ---------------------------------------------------------------------------
// PR Why + Risk Brief (Step 4/5) — LLM-facing structured-output schema.
//
// Narrower than the full `LlmBrief`/`Risk` shared types (co-located here per
// `onboarding/constants.ts`'s precedent of keeping a module's LLM schema next
// to its other constants). NO `github_link` field on either `risks[]` or
// `review_focus[]` entries — that is computed server-side, post-validation,
// by `BriefGeneratorService` (Step 4g) via `buildGithubBlobLink`.
//
// NOTE: Step 5 (serialized after this step) adds `BRIEF_GENERATE_RATE_LIMIT`
// and `BRIEF_INPUT_TOKEN_BUDGET` to this same file — nothing here should be
// removed/renamed to make room for that addition.
// ---------------------------------------------------------------------------

const RiskBriefLlmRisk = z.object({
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  kind: z.string(),
  file: z.string().nullish(),
  line: z.number().int().nullish(),
  endpoint: z.string().nullish(),
  symbol: z.string().nullish(),
});

const RiskBriefLlmReviewFocusItem = z.object({
  path: z.string(),
  line: z.number().int().nullish(),
  reason: z.string(),
  priority: z.number().int(),
});

export const RiskBriefLlmResult = z.object({
  what: z.string(),
  why: z.string(),
  risk_level: RiskLevel,
  risks: z.array(RiskBriefLlmRisk),
  review_focus: z.array(RiskBriefLlmReviewFocusItem),
});
export type RiskBriefLlmResult = z.infer<typeof RiskBriefLlmResult>;

// ---------------------------------------------------------------------------
// Step 5 additions — rate limit for the explicit generate/regenerate route,
// and a re-export of the single source of truth for the input token budget
// (defined in `brief-generator-helpers.ts` — Step 3 — never duplicated here
// as a second literal).
// ---------------------------------------------------------------------------

export const BRIEF_GENERATE_RATE_LIMIT = { max: 3, timeWindow: '1 minute' } as const;

export { BRIEF_INPUT_TOKEN_BUDGET } from './brief-generator-helpers.js';
