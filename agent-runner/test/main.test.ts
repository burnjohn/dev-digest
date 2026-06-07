import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Finding } from '@devdigest/shared';
import { resolveAgentSlugs, buildArtifact } from '../src/main.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

function finding(severity: string): Finding {
  return {
    severity,
    category: 'security',
    title: 't',
    file: 'src/config.ts',
    start_line: 11,
    end_line: 11,
    rationale: 'r',
    confidence: 0.9,
    kind: 'finding',
  } as Finding;
}

describe('resolveAgentSlugs', () => {
  it('globs .devdigest/agents when all=true', async () => {
    const slugs = await resolveAgentSlugs({ all: true, agentsDir: join(FIX, 'agents') });
    expect(slugs).toContain('security-reviewer');
  });

  it('uses a single agent slug', async () => {
    expect(await resolveAgentSlugs({ agent: 'sec', agentsDir: 'x' })).toEqual(['sec']);
  });

  it('prefers the multiline agents list', async () => {
    expect(await resolveAgentSlugs({ agents: ['a', 'b'], agentsDir: 'x' })).toEqual(['a', 'b']);
  });

  it('throws when nothing is specified', async () => {
    await expect(resolveAgentSlugs({ agentsDir: 'x' })).rejects.toThrow(/agent/);
  });
});

describe('buildArtifact', () => {
  it('aggregates severities, cost and agents into one CiResultArtifact', () => {
    const art = buildArtifact(
      [
        { agent: 'sec', findings: [finding('CRITICAL'), finding('WARNING')], costUsd: 0.01, durationMs: 1200 },
        { agent: 'perf', findings: [finding('SUGGESTION')], costUsd: 0.02, durationMs: 800 },
      ],
      482,
    );
    expect(art.findings_count).toBe(3);
    expect(art.critical).toBe(1);
    expect(art.warning).toBe(1);
    expect(art.suggestion).toBe(1);
    expect(art.cost_usd).toBeCloseTo(0.03, 5);
    expect(art.duration_ms).toBe(2000);
    expect(art.agent).toBe('sec,perf');
    expect(art.pr_number).toBe(482);
  });

  it('cost is null when any agent reports null cost', () => {
    const art = buildArtifact(
      [{ agent: 'sec', findings: [], costUsd: null, durationMs: 10 }],
      1,
    );
    expect(art.cost_usd).toBeNull();
    expect(art.findings_count).toBe(0);
  });
});
