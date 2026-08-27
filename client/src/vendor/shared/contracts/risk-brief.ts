import { z } from 'zod';

/**
 * PR Risk Brief — the wire contract for `POST /pulls/:id/brief`
 * (server/specs/SPEC-02-pr-risk-brief.md).
 *
 * One model call produces a `what` / `why` / `risk_level` / `risks[]` /
 * `review_focus[]` judgement about a pull request, cached on `pr_brief` keyed
 * on `pr_id` alone. Every `file` the model names is verified against a
 * grounded path set (built from `pr_files` and the blast response) before
 * persistence — an ungrounded `risks[].file` or `review_focus[].file` is
 * dropped, never trusted (AC-6, AC-7).
 *
 * NAME COLLISION NOTE: `contracts/brief.ts` already exports `Intent`, `Risk`,
 * `Risks`, `RiskSeverity`, `BlastRadius`, `ChangedSymbol`, `BlastCaller`,
 * `DownstreamImpact`, `PrHistory`, `PrHistoryItem`, `PrBrief` for the legacy
 * PR-brief shape (unused by this feature, Tier A, never removed or amended).
 * `vendor/shared/index.ts` is a flat `export *` barrel, so every name below
 * deliberately avoids those — the same hazard `blast-api.ts` calls out in its
 * own header and resolves the same way.
 */

export const RiskBriefLevel = z.enum(['low', 'medium', 'high']);
export type RiskBriefLevel = z.infer<typeof RiskBriefLevel>;

export const RiskBriefArea = z.object({
  title: z.string().min(1).max(120),
  explanation: z.string().min(1).max(600),
  severity: RiskBriefLevel,
  /** REQUIRED — never optional, never nullable (AC-37). A repository-relative path.
   *  Grounded (AC-6). No line number (AC-13). A dependency risk names `package.json`;
   *  an endpoint risk names the route file. */
  file: z.string().min(1),
  /** An endpoint label from the blast chips, IN ADDITION to `file`, or null.
   *  Grounded (AC-8) — an ungrounded endpoint is nulled, not dropped. */
  endpoint: z.string().nullable(),
});
export type RiskBriefArea = z.infer<typeof RiskBriefArea>;

export const RiskBriefFocusItem = z.object({
  /** Grounded (AC-7). No line number (AC-13) — see the design review. */
  file: z.string().min(1),
  reason: z.string().min(1).max(200),
});
export type RiskBriefFocusItem = z.infer<typeof RiskBriefFocusItem>;

/** Per-source availability, so the UI can say what the brief was built without (D8).
 *  `skipped` is required, not decorative: a `.md` file the aggregate excerpt budget
 *  never reached is recorded `skipped` without a read (`## Non-functional requirements`,
 *  and the "PR body naming 50 `.md` files" edge case). The neighbouring
 *  `IntentSourceStatus` (`contracts/intent.ts:46-53`) carries the same member for the
 *  same reason. */
export const RiskBriefSourceStatus = z.enum([
  'used',
  'truncated',
  'skipped',
  'partial',
  'missing',
  'unavailable',
]);
export type RiskBriefSourceStatus = z.infer<typeof RiskBriefSourceStatus>;

export const RiskBriefSources = z.object({
  intent: RiskBriefSourceStatus,
  blast: RiskBriefSourceStatus,
  pr_body: RiskBriefSourceStatus,
  linked_issue: RiskBriefSourceStatus,
  file_list: RiskBriefSourceStatus,
  /** One entry per `.md` path considered, with its own status. */
  md_files: z.array(z.object({ path: z.string(), status: RiskBriefSourceStatus })),
});
export type RiskBriefSources = z.infer<typeof RiskBriefSources>;

/** The ONE structured-output schema. Deliberately excludes pr_id/model/generated_at —
 *  those are server-observed, never model-reported. */
export const RiskBriefGeneration = z.object({
  what: z.string().min(1).max(600),
  why: z.string().min(1).max(600),
  risk_level: RiskBriefLevel,
  risks: z.array(RiskBriefArea),
  review_focus: z.array(RiskBriefFocusItem),
});
export type RiskBriefGeneration = z.infer<typeof RiskBriefGeneration>;

/** POST /pulls/:id/brief response, and the shape stored in `pr_brief.json`. */
export const RiskBriefResponse = RiskBriefGeneration.extend({
  pr_id: z.string(),
  sources: RiskBriefSources,
  model: z.string().nullish(),
  generated_at: z.string().nullish(),
});
export type RiskBriefResponse = z.infer<typeof RiskBriefResponse>;

export const RiskBriefRequest = z.object({ force: z.boolean().nullish() });
export type RiskBriefRequest = z.infer<typeof RiskBriefRequest>;
