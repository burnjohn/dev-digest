import { pgTable, uuid, text, integer, boolean, jsonb, primaryKey, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces, users } from './core';
import { skills } from './skills';

// ============================================================ Agents & skills

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  provider: text('provider', { enum: ['openai', 'anthropic', 'openrouter'] }).notNull(),
  model: text('model').notNull(),
  systemPrompt: text('system_prompt').notNull(),
  outputSchema: jsonb('output_schema'),
  // Legacy compatibility field. The engine now plans review chunks automatically.
  strategy: text('strategy', { enum: ['single-pass', 'map-reduce', 'auto'] })
    .notNull()
    .default('single-pass'),
  // CI gate policy — when a CI review should BLOCK (REQUEST_CHANGES + fail the
  // check) vs just comment. Deterministic from finding severities.
  ciFailOn: text('ci_fail_on', { enum: ['never', 'critical', 'warning', 'any'] })
    .notNull()
    .default('critical'),
  // Whether this agent's reviews get repo-intel context (repo skeleton + callers
  // + file-rank note) injected into the prompt. Default on; the global
  // REPO_INTEL_ENABLED flag is the second gate (facade degrades when off).
  repoIntel: boolean('repo_intel').notNull().default(true),
  enabled: boolean('enabled').notNull().default(true),
  version: integer('version').notNull().default(1),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: now(),
});

export const agentVersions = pgTable(
  'agent_versions',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    configJson: jsonb('config_json').notNull(),
    createdAt: now(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.agentId, t.version] }) }),
);

export const agentSkills = pgTable(
  'agent_skills',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    order: integer('order').notNull().default(0),
    // Per-link switch, distinct from the skill's own global `enabled`. Unchecking
    // a skill in the agent's Skills tab keeps the link (and its order) but stops
    // the body being appended to THIS agent's prompt. A skill is injected only
    // when both flags are true.
    enabled: boolean('enabled').notNull().default(true),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.agentId, t.skillId] }),
    // Reverse lookup: "which agents use this skill?" (the Skills grid's used-by
    // count and the delete confirmation). The PK covers agent_id only.
    skillIdx: index('agent_skills_skill_idx').on(t.skillId),
  }),
);
