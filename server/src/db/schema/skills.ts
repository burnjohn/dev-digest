import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  primaryKey,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';

export const skills = pgTable(
  'skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    type: text('type', { enum: ['rubric', 'convention', 'security', 'custom'] }).notNull(),
    source: text('source', {
      enum: ['manual', 'imported_url', 'extracted', 'community'],
    }).notNull(),
    body: text('body').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    version: integer('version').notNull().default(1),
    evidenceFiles: jsonb('evidence_files').$type<string[]>(),
    createdAt: now(),
  },
  (t) => ({
    // Every read is workspace-scoped (the Skills grid, the agent editor's
    // picker); Postgres does not index foreign keys automatically.
    workspaceIdx: index('skills_workspace_idx').on(t.workspaceId),
    // `text({ enum })` narrows TypeScript only and emits no DB constraint —
    // these mirror the SkillType / SkillSource contract enums into Postgres.
    typeCk: check('skills_type_ck', sql`${t.type} in ('rubric', 'convention', 'security', 'custom')`),
    sourceCk: check(
      'skills_source_ck',
      sql`${t.source} in ('manual', 'imported_url', 'extracted', 'community')`,
    ),
  }),
);

export const skillVersions = pgTable(
  'skill_versions',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    body: text('body').notNull(),
    // Optional note the author typed when saving ("Added Tests dimension").
    // Nullable by design: a save without one still snapshots, and the UI falls
    // back to a diff-derived summary rather than inventing a message.
    message: text('message'),
    createdAt: now(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.skillId, t.version] }) }),
);
