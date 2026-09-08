import { sql, desc } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  uniqueIndex,
  index,
  boolean,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { pullRequests } from './pulls';
import type { EvalExpectation, EvalCaseOutcome, EvalRun } from '@devdigest/shared';

// ============================================================ Eval / Conformance / Compose
//
// specs/12-eval-pipeline.md (L06) — `eval_cases` / `eval_runs` reshaped in
// place (D1). Both tables were confirmed at zero rows before this migration
// (server/LEARNINGS.md's "reserved-but-unwired" pattern), so `NOT NULL`
// without a default is safe here.

export const evalCases = pgTable(
  'eval_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    // D8/D16 — the frozen, self-contained diff fragment (this file's hunks
    // only), never a live pointer.
    inputDiff: text('input_diff').notNull(),
    inputFiles: jsonb('input_files').$type<string[]>().notNull(),
    // D16's trimmed PR metadata: { pr_number, title, body }.
    inputMeta: jsonb('input_meta').notNull(),
    // Reserved column name kept as-is (renaming would be a drop+add on a
    // table that also gains columns — finding 4's two-pass trap). The DTO
    // field is `expectation`; this column holds that same object (D3).
    expectedOutput: jsonb('expected_output').$type<EvalExpectation>().notNull(),
    notes: text('notes'),
    // The finding this case was created from — no FK (D8: a case outlives
    // its finding, review, PR and repo). Null for a hand-authored/fixture
    // case; the unique index below only applies to non-null values
    // (Postgres allows many NULLs through a unique index).
    sourceFindingId: uuid('source_finding_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // D17/AC-1, widened by specs/15-skill-eval-cases.md clarification 2 —
    // idempotency is scoped to the finding AND THE OWNER, not the finding
    // alone: SPEC-12 already writes an agent-owned case from a triaged
    // finding, so a single-column unique index would collide the moment a
    // skill-owned case is created from the same finding (and vice versa —
    // "the same finding turned into cases for three different injected
    // skills" is an explicit, allowed edge case). Postgres still lets many
    // NULLs through a unique index, so hand-authored/fixture cases
    // (`sourceFindingId: null`) are unaffected either way.
    sourceFindingUq: uniqueIndex('eval_cases_source_finding_uq').on(
      t.sourceFindingId,
      t.ownerKind,
      t.ownerId,
    ),
    ownerIdx: index('eval_cases_owner_idx').on(t.workspaceId, t.ownerKind, t.ownerId),
  }),
);

export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    // `ranAt` (pre-existing) is reused as the run's START time.
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    status: text('status', { enum: ['running', 'completed', 'errored'] })
      .notNull()
      .default('running'),
    // D4 — the configuration version this run executed against: the AGENT's
    // own version on an agent-owned run, and (specs/15-skill-eval-cases.md
    // D6) the CARRIER's version on a skill-owned run — same column, same
    // meaning ("the config version this run executed against"), never a
    // second column.
    agentVersion: integer('agent_version'),
    // D5 — the exact set of case ids this run covered (apples-to-apples
    // comparison, AC-33).
    caseIds: jsonb('case_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    // Q1 — the per-case outcome array (the reserved `EvalRun.per_trace`
    // reshaped into `EvalRun.per_case`, stored alongside the set-level
    // metrics below).
    perCase: jsonb('per_case').$type<EvalCaseOutcome[]>().notNull().default(sql`'[]'::jsonb`),
    casesErrored: integer('cases_errored').notNull().default(0),
    tracesPassed: integer('traces_passed'),
    tracesTotal: integer('traces_total'),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    errorReason: text('error_reason'),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    durationMs: integer('duration_ms'),
    costUsd: doublePrecision('cost_usd'),
    // ---- specs/15-skill-eval-cases.md (R1) — skill-owned run identity ----
    // All four are null on every agent-owned run, past and future.
    // D6 — the `skills.version` this run injected into the with-arm.
    skillVersion: integer('skill_version'),
    // D2/D6/D11 — the carrier agent's identity. Deliberately no FK, matching
    // `ownerId`'s existing polymorphic posture above; cascade-on-delete is
    // application-side (see `SkillsService.delete`'s `evalCleanup` port).
    carrierAgentId: uuid('carrier_agent_id'),
    // D8/AC-52 — true when either enable gate was off for this skill/carrier
    // at run time (the with-arm still injected the body regardless).
    gatesBypassed: boolean('gates_bypassed').notNull().default(false),
    // D3 — the without-arm's whole `EvalRun` (its own `per_case` included),
    // persisted in full per clarification 5 (AC-36 needs the complete
    // finding sets, not aggregates only). Null on every agent-owned run.
    armWithout: jsonb('arm_without').$type<EvalRun>(),
  },
  (t) => ({
    ownerIdx: index('eval_runs_owner_idx').on(
      t.workspaceId,
      t.ownerKind,
      t.ownerId,
      desc(t.ranAt),
    ),
  }),
);

export const conformanceChecks = pgTable('conformance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  specId: text('spec_id').notNull(),
  completenessPct: doublePrecision('completeness_pct'),
  items: jsonb('items'),
});

export const composedReviews = pgTable('composed_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  verdict: text('verdict'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  githubReviewId: text('github_review_id'),
});
