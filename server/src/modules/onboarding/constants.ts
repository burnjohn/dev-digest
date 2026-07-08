import { z } from 'zod';

/**
 * onboarding module constants.
 *
 * Bounded-LLM-input caps (spec §4/§11) — enforced in `helpers.ts`'s
 * `buildLlmInput`. Never relaxed at the call site; `getAllFileFacts` itself
 * stays uncapped (it's a general aggregation read), the caps below apply only
 * to what actually gets sent to `completeStructured`.
 */
export const LLM_INPUT_TOP_N_FILES = 20;
export const LLM_INPUT_MAX_ENDPOINTS = 60;
export const LLM_INPUT_MAX_ROUTES_PER_FILE = 10;
export const LLM_INPUT_MAX_BYTES = 40_000;

/**
 * AUTHORITATIVE 5-section list — single source of truth for both the
 * `{{sections}}` prompt template slot (rendered via `platform/prompts.ts`)
 * and everywhere `generateTour` assembles `OnboardingTourSection[]`. Keep in
 * sync with `OnboardingTourSectionKind` (`@devdigest/shared`) — that Zod enum
 * is the cross-package authority this array must never drift from.
 */
export const ONBOARDING_SECTION_KINDS = [
  'architecture',
  'critical_paths',
  'how_to_run',
  'reading_path',
  'first_tasks',
] as const;

/** `{{language}}` prompt template value — narrative is English-only in v1. */
export const ONBOARDING_PROMPT_LANGUAGE = 'English';

/** Per-workspace rate limit for POST /repos/:id/onboarding/generate. */
export const ONBOARDING_RATE_LIMIT = { max: 3, timeWindow: '1 minute' } as const;

/** Template filename passed to `platform/prompts.ts`'s loader. */
export const ONBOARDING_SYSTEM_PROMPT_PATH = 'onboarding.system.md';

// ---------------------------------------------------------------------------
// LLM structured-output schema (narrative-only).
//
// The LLM produces ONLY: per-section title/body/diagram, plus a per-entry
// rationale keyed by path (for critical_paths/reading_path) and tasks/links
// for the other kinds. It does NOT emit `rank`, final entry ORDER,
// `github_link`, or index-health metadata — those are assembled/enforced
// deterministically by the service (AC-4/AC-5/AC-7).
// ---------------------------------------------------------------------------

const LlmEntry = z.object({
  path: z.string(),
  rationale: z.string(),
});

const LlmTask = z.object({
  title: z.string(),
  target_path: z.string(),
  complexity: z.enum(['low', 'medium', 'high']),
});

const LlmLink = z.object({
  label: z.string(),
  path: z.string(),
});

const LlmSection = z.object({
  kind: z.enum(ONBOARDING_SECTION_KINDS),
  title: z.string(),
  body: z.string(),
  diagram: z.string().nullable(),
  // Structured-outputs (OpenAI) require every field to be required OR nullable —
  // `.optional()`/`.default()` is rejected. These per-kind payload arrays are
  // nullable (a section that doesn't use one emits null); the service treats
  // null as an empty array.
  entries: z.array(LlmEntry).nullable(),
  tasks: z.array(LlmTask).nullable(),
  links: z.array(LlmLink).nullable(),
});

/** Narrower schema passed to `completeStructured` — narrative sections only. */
export const OnboardingNarrativeResult = z.object({
  sections: z.array(LlmSection).length(5),
});
export type OnboardingNarrativeResult = z.infer<typeof OnboardingNarrativeResult>;
export type OnboardingNarrativeSection = z.infer<typeof LlmSection>;
