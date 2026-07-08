import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, doublePrecision, index } from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { pullRequests } from './pulls';
import { agents } from './agents';
import { skills } from './skills';

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
});

export const evalBatches = pgTable(
  'eval_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['full', 'calibration'] }).notNull(),
    // Null ONLY while a batch is unsealed (the row is inserted before its cases
    // run). Once sealed, EVERY batch — full AND calibration — gets clean/degraded:
    // the client uses `status != null` as the run-completion signal, so leaving
    // calibration null made single-case runs appear to hang. The full-vs-
    // calibration distinction is carried by `kind`, not by a null status.
    status: text('status', { enum: ['clean', 'degraded'] }),
    agentSnapshot: jsonb('agent_snapshot').notNull(),
    systemPromptSnapshot: text('system_prompt_snapshot'),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    costUsd: doublePrecision('cost_usd'),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    agentIdx: index('eval_batches_agent_id_idx').on(t.agentId),
    workspaceIdx: index('eval_batches_workspace_id_idx').on(t.workspaceId),
  }),
);

export const skillEvalBatches = pgTable(
  'skill_eval_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    hostAgentId: uuid('host_agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['full', 'calibration'] }).notNull(),
    // Null ONLY while unsealed (row inserted before case-runs execute).
    // Sealed to 'clean' | 'degraded' once every case-run in the batch completes
    // (mirrors eval_batches.status's exact null-until-sealed convention).
    status: text('status', { enum: ['clean', 'degraded'] }),
    // Fingerprint of (skill.body + skill.version + host agent's model + host
    // agent's id) at run time — AC-17. Never derived from skill body alone.
    snapshotIdentity: jsonb('snapshot_identity').notNull(),
    model: text('model').notNull(), // host agent's model at run time, display metadata
    judgeScore: doublePrecision('judge_score'),
    groundingPassRate: doublePrecision('grounding_pass_rate'),
    casesPassing: integer('cases_passing'),
    casesTotal: integer('cases_total'),
    costUsd: doublePrecision('cost_usd'),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    skillIdx: index('skill_eval_batches_skill_id_idx').on(t.skillId),
    hostAgentIdx: index('skill_eval_batches_host_agent_id_idx').on(t.hostAgentId),
    workspaceIdx: index('skill_eval_batches_workspace_id_idx').on(t.workspaceId),
  }),
);

export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => evalCases.id, { onDelete: 'cascade' }),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    actualOutput: jsonb('actual_output'),
    pass: boolean('pass'),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    durationMs: integer('duration_ms'),
    costUsd: doublePrecision('cost_usd'),
    batchId: uuid('batch_id').references(() => evalBatches.id, { onDelete: 'set null' }),
    skillBatchId: uuid('skill_batch_id').references(() => skillEvalBatches.id, { onDelete: 'set null' }),
    // Persisted at WRITE time (#4) — the drill-down view must render the
    // matched/expected counts AS THEY WERE when the run happened, not
    // re-scored against the case's CURRENT expected_output (which may have
    // been edited since). Nullable: existing rows written before this column
    // existed have no snapshot to backfill from.
    matchedCount: integer('matched_count'),
    expectedCount: integer('expected_count'),
    // Concise cause string for a runtime-failed run (per-case catch in
    // `runOneCase`, or an unexpected `executeBatch` fan-out failure) — makes
    // a Degraded batch's cause visible in the UI drill-down instead of only
    // server stderr logs. Null for deterministic passed/failed runs.
    errorMessage: text('error_message'),
  },
  (t) => ({
    batchIdx: index('eval_runs_batch_id_idx').on(t.batchId),
    skillBatchIdx: index('eval_runs_skill_batch_id_idx').on(t.skillBatchId),
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
