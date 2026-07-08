import { z } from 'zod';
import { BlastIndexInfo } from './blast.js';

/**
 * OnboardingTour: persisted/API contract for the Onboarding Tour feature.
 * Consumed by: client `useOnboardingTour`/`useGenerateOnboardingTour` hooks, onboarding module routes.
 *
 * Naming note: `server/src/vendor/shared/contracts/knowledge.ts` ALREADY defines
 * `OnboardingLink`/`OnboardingSection`/`Onboarding` — an older, differently-shaped
 * placeholder. Those are untouched. Every export here uses the `OnboardingTour*`
 * prefix specifically to avoid a duplicate-export collision in the barrel.
 */

// ---- Run metadata (index health + mode + cost) ----
// Reuses BlastIndexInfo's shape (status/degraded/reason) plus onboarding-specific
// mode + cost fields, folded into one object per spec §17.
export const OnboardingTourRunMetadata = BlastIndexInfo.extend({
  mode: z.enum(['full', 'lite']),
  llm_cost_cents: z.number().int().nonnegative().nullable(),
});
export type OnboardingTourRunMetadata = z.infer<typeof OnboardingTourRunMetadata>;

// ---- GitHub blob link (per-item) ----
export const OnboardingTourLink = z.object({
  label: z.string(),
  path: z.string(),
  github_url: z.string().url().nullable(),
});
export type OnboardingTourLink = z.infer<typeof OnboardingTourLink>;

// ---- Critical Paths / Reading Path row ----
export const OnboardingTourEntry = z.object({
  path: z.string(),
  rationale: z.string(),
  rank: z.number().nullable(),           // null in lite mode (no import graph available)
  github_link: z.string().url().nullable(), // null when unresolvable
});
export type OnboardingTourEntry = z.infer<typeof OnboardingTourEntry>;

// ---- First Tasks card ----
export const OnboardingTourTask = z.object({
  title: z.string(),
  target_path: z.string(),
  complexity: z.enum(['low', 'medium', 'high']),
});
export type OnboardingTourTask = z.infer<typeof OnboardingTourTask>;

// ---- Section kind (AUTHORITATIVE list — drives both this contract and the
// onboarding.system.md prompt's {{sections}} template value; keep in sync with
// server/src/modules/onboarding/constants.ts ONBOARDING_SECTION_KINDS) ----
export const OnboardingTourSectionKind = z.enum([
  'architecture',
  'critical_paths',
  'how_to_run',
  'reading_path',
  'first_tasks',
]);
export type OnboardingTourSectionKind = z.infer<typeof OnboardingTourSectionKind>;

// ---- Section ----
// A section populates only the array(s) relevant to its `kind` (discriminated by
// convention, not a discriminated union — mirrors how BlastResponse handles
// similarly-shaped optional per-kind data). E.g. `first_tasks` populates `tasks`
// and leaves `entries`/`links` empty; `reading_path`/`critical_paths` populate
// `entries`; `architecture`/`how_to_run` may populate `links`.
export const OnboardingTourSection = z.object({
  kind: OnboardingTourSectionKind,
  title: z.string(),
  body: z.string(),
  diagram: z.string().nullable(),
  entries: z.array(OnboardingTourEntry),
  tasks: z.array(OnboardingTourTask),
  links: z.array(OnboardingTourLink),
});
export type OnboardingTourSection = z.infer<typeof OnboardingTourSection>;

// ---- Top-level response ----
export const OnboardingTour = z.object({
  repo_id: z.string().uuid(),
  generated_at: z.string().datetime().nullable(), // null = never generated
  run: OnboardingTourRunMetadata,
  sections: z.array(OnboardingTourSection).length(5),
});
export type OnboardingTour = z.infer<typeof OnboardingTour>;

// ---- Generate endpoint response (same shape — generation returns the refreshed tour synchronously) ----
export const OnboardingTourGenerateResponse = OnboardingTour;
export type OnboardingTourGenerateResponse = z.infer<typeof OnboardingTourGenerateResponse>;
