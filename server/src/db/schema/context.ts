import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  vector,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';
import { agents } from './agents';
import { skills } from './skills';

// ============================================================ Context & codebase

/**
 * `symbols.name` and `references.to_symbol` are btree-indexed
 * (`symbols_repo_name_idx`, `references_repo_decl_symbol_idx`). Postgres rejects
 * any index row larger than ~2704 bytes, so a pathological multi-KB "name" from
 * a bad parse (e.g. a whole expression captured as an identifier) crashes the
 * indexer with `index row size … exceeds btree version 4 maximum`. Real
 * identifiers are short, so clamp these values well under the limit before
 * insert. 255 chars ≤ ~1 KB even for 4-byte code points — comfortably safe.
 */
export const MAX_INDEXED_NAME_LEN = 255;
export const clampIndexedName = (s: string): string =>
  s.length > MAX_INDEXED_NAME_LEN ? s.slice(0, MAX_INDEXED_NAME_LEN) : s;

export const codeChunks = pgTable(
  'code_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    source: text('source', { enum: ['code', 'docs', 'spec'] }).notNull().default('code'),
  },
  (t) => ({
    repoIdx: index('code_chunks_repo_idx').on(t.repoId),
    wsIdx: index('code_chunks_ws_idx').on(t.workspaceId),
    // Without this, every similarity search is a sequential scan computing a
    // 1536-dimension distance per row — i.e. pgvector is enabled but unused as
    // an index. HNSW (not ivfflat) needs no training pass and stays correct as
    // rows are added, which suits an index that grows with each repo import.
    embeddingIdx: index('code_chunks_embedding_hnsw').using(
      'hnsw',
      t.embedding.op('vector_cosine_ops'),
    ),
  }),
);

/**
 * `symbols` — declared identifiers (functions/classes/methods/etc.) per repo.
 *
 * T2 extension: added `endLine`, `exported`, `signature`,
 * `contentHash`. The new columns are nullable / defaulted so existing inserts
 * (blast/service.ts `persistSymbols`) keep typechecking; the T2 indexer
 * pipeline will backfill them on the next `refreshIndex`.
 *
 * `line` carries the `start_line` semantics — kept as-is so existing
 * rows survive the migration. The composite UNIQUE prevents duplicate
 * (repo, path, name, kind, line) tuples once the indexer takes over.
 */
export const symbols = pgTable(
  'symbols',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    line: integer('line'), // = start_line
    endLine: integer('end_line'), // [T2] NEW
    exported: boolean('exported').notNull().default(false), // [T2] NEW
    signature: text('signature'), // [T2] NEW
    contentHash: text('content_hash'), // [T2] NEW (nullable — backfilled by indexer)
  },
  (t) => ({
    lookupIdx: index('symbols_repo_path_idx').on(t.repoId, t.path),
    nameIdx: index('symbols_repo_name_idx').on(t.repoId, t.name),
    uq: uniqueIndex('symbols_repo_path_name_kind_line_uq').on(
      t.repoId,
      t.path,
      t.name,
      t.kind,
      t.line,
    ),
  }),
);

/**
 * `references` — call-sites / usages of symbols.
 *
 * T2 extension: added `declFile` (NULL = unresolved → feeds the
 * Phantom-gate) and `contentHash`. The legacy columns are untouched, so
 * blast/service.ts `persistReferences` keeps working.
 */
export const references = pgTable(
  'references',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    fromPath: text('from_path').notNull(), // = ref_file
    toSymbol: text('to_symbol').notNull(), // = symbol_name
    line: integer('line').notNull(), // = ref_line
    declFile: text('decl_file'), // [T2] NEW — NULL = unresolved (Phantom-gate)
    contentHash: text('content_hash'), // [T2] NEW
  },
  (t) => ({
    byDecl: index('references_repo_decl_symbol_idx').on(
      t.repoId,
      t.declFile,
      t.toSymbol,
    ),
    byFile: index('references_repo_from_idx').on(t.repoId, t.fromPath),
  }),
);

/**
 * `context_attachments` — REQ-10: attaches a document, identified only by its
 * repository-relative path, to either an agent or a skill, scoped to one
 * repo. No part of the document's body is persisted here — the path is
 * resolved and read fresh from the repo when needed.
 *
 * The owner is modeled as two nullable cascading FKs (`agentId`, `skillId`)
 * rather than a polymorphic `(owner_type, owner_id)` pair: deleting an agent
 * or a skill cascades its attachments away instead of leaving orphaned rows
 * with no referential integrity. `ownerXorCheck` enforces "exactly one of
 * agentId / skillId is non-null" at the DB level — drizzle-orm@0.38.4
 * exposes `check()`, so this is enforced here rather than only in T7's
 * repository (which should still validate defensively before insert).
 */
export const contextAttachments = pgTable(
  'context_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id').references(() => skills.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    position: integer('position').notNull(),
    createdAt: now(),
  },
  (t) => ({
    wsIdx: index('context_attachments_ws_idx').on(t.workspaceId),
    repoIdx: index('context_attachments_repo_idx').on(t.repoId),
    agentIdx: index('context_attachments_agent_idx').on(t.agentId),
    skillIdx: index('context_attachments_skill_idx').on(t.skillId),
    // One document cannot be attached twice to the same owner in the same repo.
    // Partial (owner IS NOT NULL) because a plain UNIQUE treats NULLs as distinct
    // per-row, which would not collapse the "other owner column" NULLs anyway —
    // being explicit documents the intent.
    agentPathUq: uniqueIndex('context_attachments_agent_repo_path_uq')
      .on(t.agentId, t.repoId, t.path)
      .where(sql`${t.agentId} IS NOT NULL`),
    skillPathUq: uniqueIndex('context_attachments_skill_repo_path_uq')
      .on(t.skillId, t.repoId, t.path)
      .where(sql`${t.skillId} IS NOT NULL`),
    ownerXorCheck: check(
      'context_attachments_owner_xor_check',
      sql`(${t.agentId} IS NOT NULL AND ${t.skillId} IS NULL) OR (${t.agentId} IS NULL AND ${t.skillId} IS NOT NULL)`,
    ),
  }),
);

export const onboarding = pgTable('onboarding', {
  repoId: uuid('repo_id')
    .primaryKey()
    .references(() => repos.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
});
