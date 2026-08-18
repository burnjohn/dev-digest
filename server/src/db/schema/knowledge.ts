import { pgTable, uuid, text, jsonb, timestamp, doublePrecision, integer, boolean, vector, index } from 'drizzle-orm/pg-core';
import type { ConventionSignals } from '../../vendor/shared/contracts/knowledge.js';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';
import { skills } from './skills';

// ============================================================ Knowledge / RAG

export const memory = pgTable(
  'memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['repo', 'global', 'team'] }).notNull(),
    kind: text('kind', {
      enum: ['decision', 'convention', 'preference', 'fact', 'learning'],
    }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    confidence: doublePrecision('confidence'),
    sources: jsonb('sources'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({
    wsIdx: index('memory_ws_idx').on(t.workspaceId),
    // Same reasoning as code_chunks: recall over memory is a vector search, and
    // without an HNSW index it degrades to a full scan with a 1536-dim distance
    // computation per row.
    embeddingIdx: index('memory_embedding_hnsw').using(
      'hnsw',
      t.embedding.op('vector_cosine_ops'),
    ),
  }),
);

/**
 * Extracted house rules (L02 conventions extractor). One row per candidate rule,
 * each grounded in a real `evidence_path:evidence_start_line` in the clone.
 *
 * `status` replaces the original `accepted boolean` — a two-state flag cannot
 * express *rejected*, and rejection is load-bearing here.
 *
 * A re-scan MERGES: it deletes nothing and inserts only candidates that no existing
 * row already states. So every row for a repo, whatever its status, is dedup memory
 * — `pending` included, since a pending row left out of that comparison would be
 * re-inserted verbatim on the next scan.
 *
 * Both enums are mirrored by Zod in vendor/shared/contracts/knowledge.ts
 * (`ConventionCategory` / `ConventionStatus`) — widen both, but no migration:
 * these are plain `text` columns with no CHECK constraint.
 */
export const conventions = pgTable(
  'conventions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    category: text('category', {
      enum: ['naming', 'structure', 'error_handling', 'async', 'imports', 'typing'],
    }),
    rule: text('rule').notNull(),
    rationale: text('rationale'),
    evidencePath: text('evidence_path'),
    evidenceSnippet: text('evidence_snippet'),
    evidenceStartLine: integer('evidence_start_line'),
    evidenceEndLine: integer('evidence_end_line'),
    /**
     * Distinct FILES that follow the rule — always `supportFiles.length`. Seeded
     * rows and the UI meter both depend on that identity; add alongside, never
     * repurpose.
     */
    supportCount: integer('support_count').notNull().default(0),
    supportFiles: jsonb('support_files').$type<string[]>(),
    /** Conforming SITES in the probe strategy's unit; may exceed `supportCount`. */
    followCount: integer('follow_count').notNull().default(0),
    /**
     * Violating sites. NULLABLE ON PURPOSE — `null` means the denominator could
     * not be measured, which is a different claim from `0` ("measured, none found").
     * Defaulting either of these to 0 would turn every unverifiable rule into a
     * perfectly-conforming one, and the `capped` signal depends on the null.
     */
    violationCount: integer('violation_count'),
    conformance: doublePrecision('conformance'),
    probeStrategy: text('probe_strategy', { enum: ['text', 'symbols', 'paths'] }),
    configDeclared: boolean('config_declared').notNull().default(false),
    /** Per-signal breakdown behind `confidence` (contract: `ConventionSignals`). */
    signals: jsonb('signals').$type<ConventionSignals>(),
    confidence: doublePrecision('confidence'),
    status: text('status', { enum: ['pending', 'accepted', 'rejected'] })
      .notNull()
      .default('pending'),
    /** Which merged `<repo>-conventions` skill this rule shipped in, if any. */
    skillId: uuid('skill_id').references(() => skills.id, { onDelete: 'set null' }),
    createdAt: now(),
  },
  (t) => ({
    // The list endpoint reads (repo_id, status) on every page load, and re-scan
    // deletes by exactly that pair.
    repoStatusIdx: index('conventions_repo_status_idx').on(t.repoId, t.status),
  }),
);

/**
 * One row per extraction run — powers the header's "Detected from N sample files ·
 * last scan 1h ago" line and the cost badge. Kept separate from `conventions` so
 * the counts survive the pending-row replacement a re-scan performs.
 */
export const conventionScans = pgTable('convention_scans', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  repoId: uuid('repo_id')
    .notNull()
    .references(() => repos.id, { onDelete: 'cascade' }),
  /** Paths offered to the selection call. */
  sampledFiles: integer('sampled_files').notNull().default(0),
  /** Paths the model picked and we actually read. */
  selectedFiles: integer('selected_files').notNull().default(0),
  /** Candidates the model returned, before the grounding + dedup gates. */
  rawCount: integer('raw_count').notNull().default(0),
  /** Candidates that survived every gate and were persisted. */
  keptCount: integer('kept_count').notNull().default(0),
  /**
   * Why the rest died, split. Stored rather than derived from
   * `raw_count - kept_count`, so a plain GET of the page reports the same honest
   * numbers as the response to the scan that computed them.
   */
  droppedUngrounded: integer('dropped_ungrounded').notNull().default(0),
  /** Nothing outside the candidate's own citation followed the rule. */
  droppedUnsupported: integer('dropped_unsupported').notNull().default(0),
  droppedDuplicate: integer('dropped_duplicate').notNull().default(0),
  /** How wide the counting corpus was — the denominator behind every score. */
  countedFiles: integer('counted_files').notNull().default(0),
  countedSymbols: integer('counted_symbols').notNull().default(0),
  model: text('model'),
  costUsd: doublePrecision('cost_usd'),
  createdAt: now(),
});
