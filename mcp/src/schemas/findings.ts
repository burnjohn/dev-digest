import { z } from 'zod';

/**
 * The narrow, model-facing findings schema (ring M0) — `get_findings` and
 * `run_agent_on_pr` both validate their `structuredContent` against this,
 * and both tools' full `inputSchema`/`outputSchema` now live here too (the
 * 2026-08-23 remediation, finding 3): before this pass the two richest tools
 * declared their input/output value schemas inline in M4 while the other
 * three correctly imported theirs from `schemas/**`, and this file's own
 * `ConciseFindingsResultSchema`/`DetailedFindingsResultSchema` were exercised
 * only by `shaping.test.ts` — a schema the tests validated against that was
 * NOT the schema either tool registered. There is now exactly one.
 *
 * This is the ONE place `mcp/` deliberately diverges from
 * `onion-architecture`'s "contracts are domain types" rule (§5.12.4): inside
 * `server/` the wire contract IS the domain type, but here the wire contract
 * (`@devdigest/shared`'s `ReviewRecord` / `FindingRecord`) is not what the
 * model is allowed to see. Every field below is re-declared against this
 * package's own zod rather than re-exported from the shared contract, and
 * every field carries a comment saying why it earns its tokens (§5.3, §5.6
 * principle 3) — `agent_id` (per-finding), `review_id`, `pr_id`,
 * `accepted_at`, `dismissed_at`, `grounding`, `kind`, `category`,
 * `trifecta_components` and `evidence` all stay out on purpose.
 *
 * `run_id` and `created_at` used to be on that list and no longer are, in ONE
 * place: `AgentFindingsGroupSchema` below (2026-08-25). That is a deliberate,
 * scoped reversal, not drift. `get_findings` gained `all_runs`, and a per-run
 * group without a run id or a timestamp is a group the model cannot tell apart
 * from the next one — the two fields are what makes the parameter mean
 * anything, and they are what makes the DEFAULT ("each agent's latest run")
 * legible rather than an invisible collapse. They stay out of the per-FINDING
 * shapes, where they would be paid for once per finding instead of once per
 * group and would buy nothing.
 */

export const FindingSeverity = z.enum(['CRITICAL', 'WARNING', 'SUGGESTION']);
export type FindingSeverity = z.infer<typeof FindingSeverity>;

export const ReviewVerdict = z.enum(['request_changes', 'approve', 'comment']);
export type ReviewVerdict = z.infer<typeof ReviewVerdict>;

/**
 * `response_format: 'concise'` (default, REQ-17) — the four fields needed to
 * locate and triage a finding. `line` stands in for `start_line`: `detailed`
 * is the only shape that also needs an end, so the short name is free here.
 */
export const ConciseFindingSchema = z.object({
  severity: FindingSeverity,
  file: z.string(),
  line: z.number().int(),
  title: z.string(),
});
export type ConciseFindingShape = z.infer<typeof ConciseFindingSchema>;

/**
 * `response_format: 'detailed'` — adds exactly REQ-17's five fields.
 * `rationale`/`suggestion` are free text written by the reviewing LLM and
 * about to be read by another model: the prompt-injection surface this whole
 * server is careful about (§5.6's last bullet). They reach the model only
 * when `detailed` is explicitly requested.
 */
export const DetailedFindingSchema = ConciseFindingSchema.extend({
  id: z.string(),
  end_line: z.number().int(),
  rationale: z.string(),
  suggestion: z.string().nullable(),
  confidence: z.number(),
});
export type DetailedFindingShape = z.infer<typeof DetailedFindingSchema>;

/** Full-set severity breakdown (§5.6) — computed over every kept finding,
 *  not just the ones `shown` after the cap, so a truncated response still
 *  tells the model how much CRITICAL work remains. */
export const FindingsCountsSchema = z.object({
  critical: z.number().int(),
  warning: z.number().int(),
  suggestion: z.number().int(),
});
export type FindingsCountsShape = z.infer<typeof FindingsCountsSchema>;

/**
 * The raw `z.ZodRawShape` (a field map, never a `z.object(...)`) behind
 * `run_agent_on_pr`'s flat findings output — `RunAgentOnPrOutput` spreads it
 * and adds three more fields — and the shape `shaping.test.ts` wraps in
 * `z.object()` to validate `projectFindings`'s return value against. One
 * declaration, so registration and the test cannot drift apart.
 *
 * `get_findings` used to register it too. It no longer does: a pull carries
 * one review per agent, and one flat `verdict`/`score` had to stand for all of
 * them (see `GetFindingsOutput` below for what that cost). This shape stays
 * correct for the tool it still serves, which reports exactly one run.
 *
 * Every field stays optional on purpose: `ToolRegistration.outputSchema` is
 * typed as a flat `z.ZodRawShape`, not a top-level discriminated union
 * (§5.6's "wide-optional" shape) — `run_agent_on_pr`'s still-running and
 * failed branches validate against this same shape by leaving these fields
 * absent, and `GetFindingsOutput` below keeps the identical discipline for
 * `get_findings`'s `{}` resolution-failure branch. `note` is
 * a plain optional field (present only when `shown < total`) — never
 * `.default()`'d, which under `strict: true` structured output silently
 * masks a genuinely-missing field rather than validating its absence
 * (`server/INSIGHTS.md`, 2026-08-17). There is deliberately no `nextCursor`,
 * `cursor`, `page` or `offset` field anywhere in this file (REQ-19, decision
 * D6) — the cap plus `note` replace pagination rather than add a page token
 * next to it.
 */
export const FindingsOutputShape = {
  verdict: ReviewVerdict.nullable().optional(),
  score: z.number().int().nullable().optional(),
  counts: FindingsCountsSchema.optional(),
  findings: z.array(z.union([ConciseFindingSchema, DetailedFindingSchema])).optional(),
  shown: z.number().int().optional(),
  total: z.number().int().optional(),
  note: z.string().optional(),
} satisfies z.ZodRawShape;
export type FindingsOutputResult = z.infer<z.ZodObject<typeof FindingsOutputShape>>;

/**
 * `project.ts`'s own return type — NOT a validation schema, `project.ts` is
 * a pure function over plain data and is never a boundary anything parses
 * against. `projectFindings` never returns a partial result, so every base
 * field here is required (unlike `FindingsOutputShape`'s wide-optional
 * fields above), and `findings`' element type is pinned to the requested
 * `response_format` so `toConcise`/`toDetailed`'s callers stay type-safe.
 * Every field type is still drawn from the schemas above, so there is
 * nothing here that can drift from them.
 */
export interface ConciseFindingsResultShape {
  verdict: ReviewVerdict | null;
  score: number | null;
  counts: FindingsCountsShape;
  findings: ConciseFindingShape[];
  shown: number;
  total: number;
  note?: string;
}

export interface DetailedFindingsResultShape extends Omit<ConciseFindingsResultShape, 'findings'> {
  findings: DetailedFindingShape[];
}

/* ---------------------------------------------------------------------- */
/* get_findings(repo, pr, agent?, response_format?, severity?, file?,      */
/*              all_runs?)                                    — §5.13.4    */
/* ---------------------------------------------------------------------- */

export const GetFindingsInput = {
  repo: z.string().min(1).describe('"owner/name" of the imported repo'),
  pr: z.number().int().positive().describe('the pull request number'),
  agent: z
    .string()
    .min(1)
    .optional()
    .describe('narrow to one agent — an id or name from list_agents; omit for every agent that reviewed'),
  response_format: z
    .enum(['concise', 'detailed'])
    .optional()
    .describe('"concise" (default) or "detailed" — detailed adds rationale/suggestion/confidence per finding'),
  severity: FindingSeverity.optional().describe('narrow to one severity — CRITICAL, WARNING or SUGGESTION'),
  file: z.string().optional().describe('narrow to findings on exactly this file path'),
  all_runs: z
    .boolean()
    .optional()
    .describe("true = one group per stored run; omit for each agent's latest run only"),
};

/**
 * All fields optional (same reasoning as `RunAgentOnPrOutput` below): a
 * resolution failure (repo not imported, malformed repo) returns `{}`, never
 * `{findings: []}` — an empty structured result would misreport "could not
 * resolve the PR" as "this PR has zero findings" (the 2026-08-17 fail-open
 * insight `run-agent-on-pr.test.ts`/`get-findings.test.ts` both guard).
 * `get_findings` needs no TOP-LEVEL `run_id`/`status`/`poll_with` — it never
 * starts a run, so it has no single run to report on — but it does add
 * `agents`, one entry per agent that reviewed (or, under `all_runs`, per run).
 * Each of those groups carries its OWN `run_id`; that is a different field
 * answering a different question, and the two must not be conflated.
 *
 * It does NOT reuse `FindingsOutputShape` any more. A pull carries one review
 * per agent, and a flat shape forced one `verdict`/`score` to stand for all of
 * them: the live answer for PR #7 carried five CRITICAL findings from the API
 * Contract Reviewer under the Performance Reviewer's `approve`/100, because
 * `projectFindings` reads those two fields off `reviews[0]` whatever agent
 * produced it. Grouping puts each verdict back beside the findings it judged.
 * `run_agent_on_pr` keeps the flat shape — it reports exactly one run.
 */
export const AgentFindingsGroupSchema = z.object({
  agent_id: z.string().nullable(),
  agent_name: z.string().nullable(),
  /** Which run this group came from. Nullable on the wire — `reviews.run_id`
   *  has been nullable since migration 0008 with no backfill — so a null here
   *  means "not recorded", never "no run". Under `all_runs` this is the only
   *  field that distinguishes two groups from the same agent. */
  run_id: z.string().nullable(),
  /** The review's ISO-8601 timestamp. Present in BOTH modes on purpose: under
   *  the default it is what tells a reader *which* run the latest-wins rule
   *  picked, which is the question `all_runs` exists to answer. */
  created_at: z.string(),
  /** `false` = this agent never reviewed this pull, so there is no stored
   *  result — distinct from a review that ran and found nothing, which is
   *  `true` with an empty `findings` array. Collapsing the two is what makes
   *  a reader reach for `run_agent_on_pr` when it should not. */
  reviewed: z.boolean(),
  verdict: ReviewVerdict.nullable(),
  score: z.number().int().nullable(),
  counts: FindingsCountsSchema,
  findings: z.array(z.union([ConciseFindingSchema, DetailedFindingSchema])),
  shown: z.number().int(),
  total: z.number().int(),
});
export type AgentFindingsGroupResult = z.infer<typeof AgentFindingsGroupSchema>;

export const GetFindingsOutput = {
  agents: z.array(AgentFindingsGroupSchema).optional(),
  /** Present only when zero or one agent is in the answer — with two or more,
   *  no single verdict is true of all of them, so the field is omitted rather
   *  than filled with one group's value. Each group carries its own. */
  verdict: ReviewVerdict.nullable().optional(),
  score: z.number().int().nullable().optional(),
  counts: FindingsCountsSchema.optional(),
  shown: z.number().int().optional(),
  total: z.number().int().optional(),
  note: z.string().optional(),
} satisfies z.ZodRawShape;

/**
 * `projectFindingsByAgent`'s own return type — the grouped counterpart of
 * `ConciseFindingsResultShape` above, and like it a plain-data type, never a
 * validation boundary. Every field is required here; the wide-optional
 * `GetFindingsOutput` above exists only so the `{}` resolution-failure branch
 * still validates.
 */
export interface ConciseAgentGroupShape {
  agent_id: string | null;
  agent_name: string | null;
  run_id: string | null;
  created_at: string;
  reviewed: boolean;
  verdict: ReviewVerdict | null;
  score: number | null;
  counts: FindingsCountsShape;
  findings: ConciseFindingShape[];
  shown: number;
  total: number;
}

export interface DetailedAgentGroupShape extends Omit<ConciseAgentGroupShape, 'findings'> {
  findings: DetailedFindingShape[];
}

export interface ConciseGroupedFindingsResultShape {
  agents: ConciseAgentGroupShape[];
  counts: FindingsCountsShape;
  shown: number;
  total: number;
  verdict?: ReviewVerdict | null;
  score?: number | null;
  note?: string;
}

export interface DetailedGroupedFindingsResultShape
  extends Omit<ConciseGroupedFindingsResultShape, 'agents'> {
  agents: DetailedAgentGroupShape[];
}

export type GetFindingsInputArgs = z.infer<z.ZodObject<typeof GetFindingsInput>>;
export type GetFindingsOutputResult = z.infer<z.ZodObject<typeof GetFindingsOutput>>;

/* ---------------------------------------------------------------------- */
/* run_agent_on_pr(repo, pr, agent, response_format?) — §5.13.3            */
/* ---------------------------------------------------------------------- */

export const RunAgentOnPrInput = {
  repo: z.string().min(1).describe('"owner/name" of the imported repo'),
  pr: z.number().int().positive().describe('the pull request number'),
  agent: z.string().min(1).describe('an agent id or name from list_agents'),
  response_format: z
    .enum(['concise', 'detailed'])
    .optional()
    .describe('"concise" (default) or "detailed" — detailed adds rationale/suggestion/confidence per finding'),
};

/**
 * A "wide" flat output shape rather than a nested union: `run_agent_on_pr`
 * can land in the findings-shape (§5.6, `FindingsOutputShape` above) OR the
 * still-running shape (§5.13.3's second branch) OR a failed-run shape, and
 * `ToolRegistration`'s `outputSchema` is one `z.ZodRawShape` — not a
 * discriminated object union — so every field below is optional and only
 * the fields for the branch that actually fired are populated. An empty
 * `{}` (the generic resolution-error branch) is a valid value of this shape
 * on purpose: it never claims `findings: []`.
 */
export const RunAgentOnPrOutput = {
  ...FindingsOutputShape,
  run_id: z.string().optional(),
  status: z.enum(['running', 'failed']).optional(),
  poll_with: z.literal('get_findings').optional(),
} satisfies z.ZodRawShape;

export type RunAgentOnPrInputArgs = z.infer<z.ZodObject<typeof RunAgentOnPrInput>>;
export type RunAgentOnPrOutputResult = z.infer<z.ZodObject<typeof RunAgentOnPrOutput>>;
