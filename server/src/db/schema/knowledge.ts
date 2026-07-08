import { pgTable, uuid, text, jsonb, timestamp, doublePrecision, boolean, vector, index, integer, primaryKey, uniqueIndex } from 'drizzle-orm/pg-core';
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
  (t) => ({ wsIdx: index('memory_ws_idx').on(t.workspaceId) }),
);

// ============================================================ Convention Scans

export const conventionScans = pgTable(
  'convention_scans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    commitSha: text('commit_sha').notNull(),
    status: text('status', { enum: ['pending', 'running', 'done', 'failed'] })
      .notNull()
      .default('pending'),
    scannedFileCount: integer('scanned_file_count'),
    candidateCount: integer('candidate_count'),
    verifiedCount: integer('verified_count'),
    createdAt: now(),
  },
  (t) => ({
    wsIdx: index('convention_scans_ws_idx').on(t.workspaceId),
    repoIdx: index('convention_scans_repo_idx').on(t.repoId),
  }),
);

export const conventions = pgTable(
  'conventions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    // ---- original columns (never alter — 0000_init) ----
    rule: text('rule').notNull(),
    evidencePath: text('evidence_path'),
    evidenceSnippet: text('evidence_snippet'),
    confidence: doublePrecision('confidence'),
    accepted: boolean('accepted').notNull().default(false),
    // ---- added in 0012_conventions_extractor ----
    category: text('category'),
    dedupKey: text('dedup_key'),
    scanId: uuid('scan_id').references(() => conventionScans.id, { onDelete: 'set null' }),
    evidenceLine: integer('evidence_line'),
    evidenceLineEnd: integer('evidence_line_end'),
    evidenceUrl: text('evidence_url'),
    modelConfidence: doublePrecision('model_confidence'),
    verifiedConfidence: doublePrecision('verified_confidence'),
    status: text('status', {
      enum: ['pending', 'verified', 'rejected_evidence', 'accepted', 'rejected_user', 'edited'],
    })
      .notNull()
      .default('pending'),
    editedRule: text('edited_rule'),
    createdAt: now(),
  },
  (t) => ({
    wsIdx: index('conventions_ws_idx').on(t.workspaceId),
    // Partial unique index: enforce dedup only when key is set (NULLs are distinct in PG)
    dedupUq: uniqueIndex('conventions_repo_dedup_uq').on(t.repoId, t.dedupKey),
  }),
);

// Links accepted conventions to the Skill(s) they were merged into.
export const conventionSkillLinks = pgTable(
  'convention_skill_links',
  {
    conventionId: uuid('convention_id')
      .notNull()
      .references(() => conventions.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.conventionId, t.skillId] }) }),
);
