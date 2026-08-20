import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, jsonb, timestamp, doublePrecision, index, check } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';

// ============================================================ Review & findings

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prId: uuid('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id'),
    /** The agent_run that produced this review (links the timeline run ↔ review). */
    runId: uuid('run_id'),
    kind: text('kind', { enum: ['summary', 'review'] }).notNull(),
    verdict: text('verdict'),
    summary: text('summary'),
    score: integer('score'),
    model: text('model'),
    createdAt: now(),
  },
  (t) => ({
    // Every read of this table filters by pr_id and takes newest-first: the PR
    // list's score/findings join and GET /pulls/:id/reviews. Postgres does not
    // index foreign keys automatically.
    prCreatedIdx: index('reviews_pr_created_idx').on(t.prId, t.createdAt.desc()),
    // deleteAgentRun and the client's run↔review join look rows up by run_id
    // (reviews.run_id has no FK); prCreatedIdx already covers the pr_id prefix.
    runIdx: index('reviews_run_id_idx').on(t.runId),
    // `text({ enum })` narrows the TypeScript type and emits NO DB constraint,
    // so these mirror the contract enums into Postgres. Anything writing this
    // table outside the app (a fixture, a manual fix, a future CI runner) is
    // held to the same value set the code assumes when it reads back.
    kindCk: check('reviews_kind_ck', sql`${t.kind} in ('summary', 'review')`),
    // Nullable: a CHECK is satisfied when the expression is NULL, so
    // "no verdict yet" stays legal without an explicit OR IS NULL.
    verdictCk: check(
      'reviews_verdict_ck',
      sql`${t.verdict} in ('request_changes', 'approve', 'comment')`,
    ),
  }),
);

export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    file: text('file').notNull(),
    startLine: integer('start_line').notNull(),
    endLine: integer('end_line').notNull(),
    severity: text('severity').notNull(),
    category: text('category').notNull(),
    title: text('title').notNull(),
    rationale: text('rationale').notNull(),
    suggestion: text('suggestion'),
    confidence: doublePrecision('confidence').notNull(),
    kind: text('kind').notNull().default('finding'),
    trifectaComponents: jsonb('trifecta_components').$type<string[]>(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  },
  (t) => ({
    // Findings are always fetched by their parent review — one review at a time
    // on the detail page, `inArray(reviewId, …)` for the PR list's severity counts.
    reviewIdx: index('findings_review_idx').on(t.reviewId),
    // Severity casing is load-bearing: the PR list's chips and the detail
    // page's counters both bucket on these exact strings, and an unrecognised
    // value would be silently dropped from every tally rather than reported.
    severityCk: check(
      'findings_severity_ck',
      sql`${t.severity} in ('CRITICAL', 'WARNING', 'SUGGESTION')`,
    ),
    categoryCk: check(
      'findings_category_ck',
      sql`${t.category} in ('bug', 'security', 'perf', 'style', 'test')`,
    ),
    kindCk: check(
      'findings_kind_ck',
      sql`${t.kind} in ('finding', 'secret_leak', 'lethal_trifecta', 'phantom', 'hook')`,
    ),
  }),
);

export const prIntent = pgTable('pr_intent', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  intent: text('intent').notNull(),
  inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
});

export const prBrief = pgTable('pr_brief', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
});
