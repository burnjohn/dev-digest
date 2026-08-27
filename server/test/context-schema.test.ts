import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { contextAttachments } from '../src/db/schema/context.js';

/**
 * REQ-10 — schema-only assertions, hermetic (no DB). Pins the column set,
 * the two-nullable-FK owner shape with cascade deletes, the exactly-one-of
 * CHECK, and the explicit indexes — so a later rename or dropped constraint
 * fails a fast unit test rather than surfacing only in `drizzle-kit generate`
 * or in production.
 */
describe('db/schema/context: contextAttachments', () => {
  it('carries exactly the columns REQ-10 specifies, with no text/content column', () => {
    const columns = getTableColumns(contextAttachments);

    expect(Object.keys(columns).sort()).toEqual(
      [
        'id',
        'workspaceId',
        'repoId',
        'agentId',
        'skillId',
        'path',
        'position',
        'createdAt',
      ].sort(),
    );

    // The wire (DB) column names, not just the JS property names.
    const dbNames = Object.values(columns).map((c) => c.name);
    expect(dbNames.sort()).toEqual(
      [
        'id',
        'workspace_id',
        'repo_id',
        'agent_id',
        'skill_id',
        'path',
        'position',
        'created_at',
      ].sort(),
    );

    // REQ-10: no part of a document's body is persisted.
    expect(columns).not.toHaveProperty('content');
    expect(columns).not.toHaveProperty('body');
    expect(columns).not.toHaveProperty('text');
  });

  it('scopes to a repo and gives the path/position REQ-10 requires', () => {
    const columns = getTableColumns(contextAttachments);

    expect(columns.repoId.notNull).toBe(true);
    expect(columns.path.notNull).toBe(true);
    expect(columns.path.dataType).toBe('string');
    expect(columns.position.notNull).toBe(true);
    expect(columns.position.dataType).toBe('number');
  });

  it('models the owner as two nullable, cascading FKs — never a polymorphic pair', () => {
    const columns = getTableColumns(contextAttachments);

    // Nullable: no single owner column is required, since exactly one of the
    // two carries the owner and the other is NULL.
    expect(columns.agentId.notNull).toBe(false);
    expect(columns.skillId.notNull).toBe(false);

    const { foreignKeys } = getTableConfig(contextAttachments);
    const byColumn = new Map(
      foreignKeys.map((fk) => {
        const ref = fk.reference();
        return [ref.columns[0].name, { table: ref.foreignTable, onDelete: fk.onDelete }];
      }),
    );

    expect(byColumn.get('workspace_id')?.onDelete).toBe('cascade');
    expect(byColumn.get('repo_id')?.onDelete).toBe('cascade');

    const agentFk = byColumn.get('agent_id');
    expect(agentFk?.onDelete).toBe('cascade');
    expect(getTableConfig(agentFk!.table as never).name).toBe('agents');

    const skillFk = byColumn.get('skill_id');
    expect(skillFk?.onDelete).toBe('cascade');
    expect(getTableConfig(skillFk!.table as never).name).toBe('skills');
  });

  it('enforces exactly-one-of(agentId, skillId) with a CHECK constraint', () => {
    const { checks } = getTableConfig(contextAttachments);
    const ownerCheck = checks.find((c) => c.name === 'context_attachments_owner_xor_check');
    expect(ownerCheck).toBeDefined();
  });

  it('explicitly indexes every FK column plus a per-owner unique on (owner, repo, path)', () => {
    const { indexes } = getTableConfig(contextAttachments);
    const byName = new Map(
      indexes.map((idx) => [
        idx.config.name,
        {
          unique: idx.config.unique ?? false,
          columns: idx.config.columns.map((c: { name: string }) => c.name),
        },
      ]),
    );

    // FK columns Postgres does not auto-index.
    expect(byName.has('context_attachments_ws_idx')).toBe(true);
    expect(byName.has('context_attachments_repo_idx')).toBe(true);
    expect(byName.has('context_attachments_agent_idx')).toBe(true);
    expect(byName.has('context_attachments_skill_idx')).toBe(true);

    // One document cannot be attached twice to one owner in one repo.
    const agentUq = byName.get('context_attachments_agent_repo_path_uq');
    expect(agentUq?.unique).toBe(true);
    expect(agentUq?.columns).toEqual(['agent_id', 'repo_id', 'path']);

    const skillUq = byName.get('context_attachments_skill_repo_path_uq');
    expect(skillUq?.unique).toBe(true);
    expect(skillUq?.columns).toEqual(['skill_id', 'repo_id', 'path']);
  });
});
