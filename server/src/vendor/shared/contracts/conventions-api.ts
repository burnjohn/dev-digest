import { z } from 'zod';
import { ConventionCandidate, ConventionStatus, SkillType } from './knowledge.js';

/**
 * Wire types owned by the `conventions` module (L02 — conventions extractor).
 *
 * `ConventionCandidate` itself (the stored entity) lives in `knowledge.ts`
 * alongside the other knowledge-layer contracts. These are the *API* shapes
 * layered on top of it — same split as `skills-api.ts` over `Skill`.
 */

/**
 * What one extraction run cost and how much of it survived the gates. Persisted
 * per run in `convention_scans`, so the header line ("Detected from N sample
 * files · last scan 1h ago") and the cost badge outlive the pending rows that a
 * re-scan replaces.
 *
 * The two `dropped_*` counts are the honest part of the UI: they are the
 * difference between what the model proposed and what we were willing to show.
 */
export const ConventionScanStats = z.object({
  sampled_files: z.number().int(),
  selected_files: z.number().int(),
  /**
   * Candidates that entered the gates. Counted AFTER the per-category filter (a
   * `typing` rule returned by the `naming` pass never was a candidate for
   * anything), so that
   * `raw_candidates - dropped_ungrounded - dropped_unsupported - dropped_duplicate === candidates.length`
   * always holds and the numbers can be shown together without qualification.
   *
   * The gates run in that order, and each drop is counted exactly once: grounding
   * (is the quote real?), support (does anything else in the repo follow it?),
   * then dedup (do we already know this?).
   */
  raw_candidates: z.number().int(),
  /** Dropped because the cited snippet was not found in the cited file. */
  dropped_ungrounded: z.number().int(),
  /**
   * Dropped because nothing outside the candidate's own citation follows the rule.
   * A rule with one site is an observation about one file, not a house convention.
   */
  dropped_unsupported: z.number().int(),
  /** Dropped as a near-duplicate of an existing skill, a past reject, or a sibling. */
  dropped_duplicate: z.number().int(),
  /** How wide the counting corpus was — the denominator behind every score. */
  counted_files: z.number().int(),
  counted_symbols: z.number().int(),
  model: z.string().nullish(),
  cost_usd: z.number().nullish(),
  created_at: z.string(),
});
export type ConventionScanStats = z.infer<typeof ConventionScanStats>;

/** The conventions page payload: the candidate list plus the last run's stats. */
export const ConventionListResult = z.object({
  candidates: z.array(ConventionCandidate),
  last_scan: ConventionScanStats.nullable(),
});
export type ConventionListResult = z.infer<typeof ConventionListResult>;

/**
 * The "edit one insight" body. Every field optional — accepting a rule and
 * rewriting its text are separate gestures in the UI and must not clobber each
 * other. Editing the snippet does NOT re-run grounding: the line numbers stay
 * as extracted, because the user is correcting the quote, not the location.
 */
export const ConventionPatch = z.object({
  rule: z.string().min(1).optional(),
  evidence_snippet: z.string().optional(),
  status: ConventionStatus.optional(),
});
export type ConventionPatch = z.infer<typeof ConventionPatch>;

/**
 * The pre-filled, still-unsaved skill the "Create skill" modal opens with: every
 * accepted rule merged into one markdown body. Nothing is persisted until the
 * user saves through `POST /skills` — the modal is editable first.
 */
export const ConventionSkillDraft = z.object({
  name: z.string(),
  description: z.string(),
  type: SkillType,
  body: z.string(),
  evidence_files: z.array(z.string()),
});
export type ConventionSkillDraft = z.infer<typeof ConventionSkillDraft>;

/** Stamp `skill_id` on the rules that shipped in a just-created skill. */
export const ConventionSkillLink = z.object({
  ids: z.array(z.string()),
  skill_id: z.string(),
});
export type ConventionSkillLink = z.infer<typeof ConventionSkillLink>;
