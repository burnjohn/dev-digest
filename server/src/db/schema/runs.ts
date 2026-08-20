import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, jsonb, timestamp, doublePrecision, index, check } from 'drizzle-orm/pg-core';
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
  },
  (t) => ({
    // Serves the PR timeline, the latest-run cost lookup on the PR list, and
    // the active-runs endpoint the client polls every 4s while a run is live.
    prRanAtIdx: index('agent_runs_pr_ran_at_idx').on(t.prId, t.ranAt.desc()),
    // Hot predicate: every PR page poll filters (workspace_id, pr_id[, status])
    // — activeRunsForPull / listRunsForPull in modules/reviews/repository/run.repo.ts.
    wsPrStatusIdx: index('agent_runs_ws_pr_status_idx').on(t.workspaceId, t.prId, t.status),
    // The boot-time reaper in app.ts sweeps every row matching status='running'
    // and marks it failed. That sweep was protected by convention alone —
    // `text({ enum })` emits no DB constraint — so a typo'd status would leave a
    // run permanently "in flight" in the UI with nothing to reap it.
    statusCk: check(
      'agent_runs_status_ck',
      sql`${t.status} in ('running', 'done', 'failed', 'cancelled')`,
    ),
    sourceCk: check('agent_runs_source_ck', sql`${t.source} in ('local', 'ci')`),
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
