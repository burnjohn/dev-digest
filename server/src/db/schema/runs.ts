import { pgTable, uuid, text, integer, jsonb, timestamp, doublePrecision, primaryKey } from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { agents } from './agents';
import { pullRequests } from './pulls';
import { skills } from './skills';

// ============================================================ Observability

export const agentRuns = pgTable('agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  prId: uuid('pr_id').references(() => pullRequests.id, { onDelete: 'set null' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
  provider: text('provider'),
  model: text('model'),
  durationMs: integer('duration_ms'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  /**
   * USD billed for this run — OpenRouter's real `usage.cost` when it reports one,
   * otherwise a PriceBook estimate. Null (never 0) when the model is unpriced or
   * the run failed before reaching the model.
   */
  costUsd: doublePrecision('cost_usd'),
  status: text('status'),
  /** Failure reason when status='failed' (LLM/API error, timeout, quota, …). */
  error: text('error'),
  source: text('source', { enum: ['local', 'ci'] }).notNull().default('local'),
  findingsCount: integer('findings_count'),
  grounding: text('grounding'),
  /** Review score (0-100) for this run; null on failed/cancelled runs. */
  score: integer('score'),
  /** Findings that tripped the agent's gate (severity ≥ ciFailOn). */
  blockers: integer('blockers'),
  /** Per-severity finding tally, snapshotted at run completion (like
   *  `findingsCount`/`blockers` — never recomputed live). */
  criticalCount: integer('critical_count'),
  warningCount: integer('warning_count'),
  suggestionCount: integer('suggestion_count'),
});

/**
 * Which skills were rendered into a run's prompt, and at what version.
 *
 * The only queryable record of "which skills were used in which run" — the
 * trace stores the concatenated skill BODIES as text inside `run_traces.trace`
 * jsonb, with no ids. Written in `run-executor.ts` right after skills are
 * resolved for the prompt, BEFORE the model is called, so a failed run still
 * records what it would have used. See specs/02-skill-detail-tabs.md.
 */
export const runSkillLinks = pgTable(
  'run_skill_links',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    /** The skill's `version` at the time of the run — not re-derived later. */
    version: integer('version').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.runId, t.skillId] }) }),
);

/** Whole trace of one run as a SINGLE jsonb document. */
export const runTraces = pgTable('run_traces', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => agentRuns.id, { onDelete: 'cascade' }),
  trace: jsonb('trace').notNull(),
});

export const multiAgentRuns = pgTable('multi_agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
});
