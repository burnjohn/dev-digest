/**
 * Write-time validation of the single-document `RunTrace` (`run.repo.ts`).
 *
 * The trace is stored as one jsonb blob and has to parse back on read, so the
 * repo parses it through the contract BEFORE the insert. This used to live in
 * an unimported `platform/trace-builder.ts`, which meant the guarantee read as
 * present while all three producers (done / cancelled / failed) wrote straight
 * past it. These tests pin it at the write boundary instead.
 *
 * Hermetic: the parse runs before any query, so a `Db` stub that fails the test
 * if it is touched is enough — and is itself the assertion for the reject case.
 */
import { describe, it, expect } from 'vitest';
import { saveRunTrace } from '../src/modules/reviews/repository/run.repo.js';
import type { Db } from '../src/db/client.js';
import type { RunTrace } from '@devdigest/shared';

/** Records the values handed to `insert().values()`; throws if never reached. */
function spyDb() {
  const seen: { runId: string; trace: unknown }[] = [];
  const db = {
    insert: () => ({
      values: (v: { runId: string; trace: unknown }) => {
        seen.push(v);
        return { onConflictDoUpdate: async () => undefined };
      },
    }),
  } as unknown as Db;
  return { db, seen };
}

const validTrace: RunTrace = {
  config: { agent: 'security', version: '3', provider: 'anthropic', model: 'claude-opus-5', pr: 7, source: 'local' },
  stats: { duration_ms: 1200, tokens_in: 10, tokens_out: 20, findings: 1, grounding: '1/1 passed', cost_usd: 0.01 },
  prompt_assembly: { system: 'sys', skills: null, memory: null, specs: null, user: 'usr' },
  tool_calls: [{ tool: 'review_file', args: 'a.ts', meta: 'single', ms: 5 }],
  raw_output: '{}',
  memory_pulled: [],
  specs_read: [],
  log: [{ t: '00.31', kind: 'info', msg: 'started' }],
};

describe('saveRunTrace — write-time contract validation', () => {
  it('persists a valid trace', async () => {
    const { db, seen } = spyDb();
    await saveRunTrace(db, 'run-1', validTrace);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ runId: 'run-1' });
    expect((seen[0].trace as RunTrace).config.agent).toBe('security');
  });

  // Mutation that would break this: dropping the `RunTraceSchema.parse` call —
  // the malformed doc would reach the insert and only blow up on read.
  it('throws instead of writing when a required field has the wrong type', async () => {
    const { db, seen } = spyDb();
    const bad = { ...validTrace, stats: { ...validTrace.stats, duration_ms: 'fast' } } as unknown as RunTrace;
    await expect(saveRunTrace(db, 'run-2', bad)).rejects.toThrow();
    expect(seen).toHaveLength(0);
  });

  it('throws instead of writing when a required section is missing entirely', async () => {
    const { db, seen } = spyDb();
    const { prompt_assembly: _dropped, ...rest } = validTrace;
    await expect(saveRunTrace(db, 'run-3', rest as unknown as RunTrace)).rejects.toThrow();
    expect(seen).toHaveLength(0);
  });

  // Strip is the contract's default; pinning it documents that the persisted
  // document is the schema's shape, not whatever the caller happened to hold.
  it('strips an unknown key rather than freezing it into the jsonb document', async () => {
    const { db, seen } = spyDb();
    const withStray = { ...validTrace, scratch: 'not in the contract' } as unknown as RunTrace;
    await saveRunTrace(db, 'run-4', withStray);
    expect(seen[0].trace).not.toHaveProperty('scratch');
  });
});
