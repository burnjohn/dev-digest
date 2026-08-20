import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  index,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { agents } from './agents';
import { pullRequests } from './pulls';

// ============================================================ Observability

export const agentRuns = pgTable(
  'agent_runs',
  {
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
   * USD cost of this run. Null means UNKNOWN (unpriced model, failed/cancelled
   * run, or a row written before the column existed) — not free. Rendering must
   * keep that distinct from 0, which is a genuinely free model.
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
  },
  (t) => ({
    // Hot predicate: every PR page poll filters (workspace_id, pr_id[, status])
    // — activeRunsForPull / listRunsForPull in modules/reviews/repository/run.repo.ts.
    wsPrStatusIdx: index('agent_runs_ws_pr_status_idx').on(t.workspaceId, t.prId, t.status),
  }),
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
