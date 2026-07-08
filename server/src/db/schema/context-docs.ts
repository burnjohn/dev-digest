import { pgTable, uuid, text, integer, primaryKey, index, unique } from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { skills } from './skills';
import { repos } from './repos';

// ============================================================ Context-document attachments
//
// Documents are not rows — they are discovered live from the repo clone at
// request/run time. These tables only store the ORDERED attachment link
// (owner -> repo-relative path), mirroring `agent_skills`'s shape. No direct
// `workspace_id` column: tenancy is enforced transitively through the owning
// `agent_id`/`skill_id` FK, whose row IS workspace-scoped (same documented
// exception as `agent_skills`).

export const agentContextDocs = pgTable(
  'agent_context_docs',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    order: integer('order').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.agentId, t.path] }),
    agentIdx: index('agent_context_docs_agent_idx').on(t.agentId),
  }),
);

export const skillContextDocs = pgTable(
  'skill_context_docs',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    order: integer('order').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.skillId, t.path] }),
    skillIdx: index('skill_context_docs_skill_idx').on(t.skillId),
  }),
);

// ============================================================ Document overlays (v2)
//
// In-browser edits / uploads of context documents persist here as a DB shadow
// overlay — NEVER written back to the clone (the clone is a read-only mirror
// hard-reset by `sync()` on every poll). The read path prefers the overlay body
// over the clone file (AC-25); a row with no matching clone file is an
// "overlay-only" (uploaded) document (AC-27). No direct `workspace_id` column —
// same documented exception as the link tables above: every query joins through
// `repos.workspace_id`. `version` is a last-write-wins race-safety counter, not
// a retrievable history.

export const docOverrides = pgTable(
  'doc_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    body: text('body').notNull(),
    version: integer('version').notNull().default(1),
  },
  (t) => ({
    repoPathUnique: unique('doc_overrides_repo_path_unique').on(t.repoId, t.path),
    repoIdx: index('doc_overrides_repo_idx').on(t.repoId),
  }),
);
