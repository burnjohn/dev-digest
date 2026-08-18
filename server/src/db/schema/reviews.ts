import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, jsonb, timestamp, doublePrecision, check } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';

// ============================================================ Review & findings

export const reviews = pgTable('reviews', {
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
});

export const findings = pgTable('findings', {
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
});

export const prIntent = pgTable(
  'pr_intent',
  {
    prId: uuid('pr_id')
      .primaryKey()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    intent: text('intent').notNull(),
    inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    confidence: text('confidence').notNull().default('high'),
    signalsUsed: jsonb('signals_used').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    riskAreas: jsonb('risk_areas').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** Head SHA the classification ran against — lets the UI show a staleness
     * indicator when the PR's current head has moved since. Nullable: rows
     * written before this column existed. */
    headSha: text('head_sha'),
  },
  (t) => ({
    confidenceCheck: check('pr_intent_confidence_check', sql`${t.confidence} IN ('high', 'medium', 'low')`),
  }),
);

export const prBrief = pgTable('pr_brief', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
});
