import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  doublePrecision,
  index,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { pullRequests } from './pulls';
import { agents } from './agents';

// ============================================================ Eval / Conformance / Compose

export const evalCases = pgTable('eval_cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
  ownerId: uuid('owner_id').notNull(),
  name: text('name').notNull(),
  inputDiff: text('input_diff'),
  inputFiles: jsonb('input_files'),
  inputMeta: jsonb('input_meta'),
  expectedOutput: jsonb('expected_output'),
  notes: text('notes'),
  // Derived, never authored — the server sets this from `expected_output`
  // emptiness on every write. See SPEC-03 "Inputs and provenance".
  expectationKind: text('expectation_kind', { enum: ['must_find', 'must_not_flag'] }),
  // Coordinates copied from a dismissed finding at draft time; untrusted
  // (originates in model output). Array of {file, start_line, end_line}.
  forbiddenRegions: jsonb('forbidden_regions'),
  // Synthesized filename for a skill-owned case's before/after source.
  inputFilename: text('input_filename'),
  // Provenance, not scoring: which finding decision seeded this case. Both
  // seeded arms store `expectation_kind = 'must_not_flag'`, so this column is
  // the only thing that tells an accepted-seeded case from a dismissed one.
  seededFrom: text('seeded_from', { enum: ['accepted', 'dismissed'] }),
});

export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => evalCases.id, { onDelete: 'cascade' }),
    // Nullable — a single ad-hoc run (AC-11/AC-50) is not part of a batch.
    // ON DELETE SET NULL: deleting a batch (AC-41) must never raise an FK
    // violation from runs that still point at it.
    batchId: uuid('batch_id').references(() => evalRunBatches.id, { onDelete: 'set null' }),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    actualOutput: jsonb('actual_output'),
    pass: boolean('pass'),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    durationMs: integer('duration_ms'),
    costUsd: doublePrecision('cost_usd'),
  },
  (t) => ({
    // Postgres does not index FKs automatically; the batch detail/progress
    // read (AC-17) filters runs by batch_id.
    batchIdx: index('eval_runs_batch_idx').on(t.batchId),
  }),
);

/**
 * One execution of "run all evals" for an owner (agent or skill). Keyed by
 * owner, not by agent, so one shape serves both owner kinds (SPEC-03
 * "Inputs and provenance"). `owner_id` carries no FK — it mirrors
 * `eval_cases.owner_id` in addressing two tables from one column, so AC-41
 * deletes an owner's batches explicitly rather than via cascade.
 */
export const evalRunBatches = pgTable(
  'eval_run_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    ownerVersion: integer('owner_version').notNull(),
    // Nullable + ON DELETE SET NULL: deleting the recorded runner agent must
    // never delete a skill's batch history (AC-69).
    runnerAgentId: uuid('runner_agent_id').references(() => agents.id, { onDelete: 'set null' }),
    runnerAgentVersion: integer('runner_agent_version'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: text('status').notNull(),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    casesPassed: integer('cases_passed'),
    casesTotal: integer('cases_total'),
    costUsd: doublePrecision('cost_usd'),
  },
  (t) => ({
    // AC-13/AC-14 look up the live batch for an owner by kind + id + status.
    ownerStatusIdx: index('eval_run_batches_owner_status_idx').on(
      t.ownerKind,
      t.ownerId,
      t.status,
    ),
    wsIdx: index('eval_run_batches_ws_idx').on(t.workspaceId),
    runnerAgentIdx: index('eval_run_batches_runner_agent_idx').on(t.runnerAgentId),
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
