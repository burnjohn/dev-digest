import { pgTable, uuid, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';

/**
 * GitHub PATs the user manages in the UI — METADATA ONLY. The token value
 * lives in the SecretsProvider under `GITHUB_TOKEN:<id>`, never here and never
 * in a migration. `repos.github_token_id` picks which one authenticates a repo.
 */
export const githubTokens = pgTable(
  'github_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    githubLogin: text('github_login'),
    createdAt: now(),
    lastValidatedAt: timestamp('last_validated_at', { withTimezone: true }),
  },
  (t) => ({
    uq: uniqueIndex('github_tokens_ws_label_uq').on(t.workspaceId, t.label),
    wsIdx: index('github_tokens_ws_idx').on(t.workspaceId),
  }),
);
