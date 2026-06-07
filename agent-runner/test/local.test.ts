import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import { parseUnifiedDiff } from '../src/diff.js';
import { loadAgent } from '../src/manifest.js';
import { MockLLMProvider } from '../src/llm.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

const CANNED = {
  verdict: 'request_changes',
  summary: 'A hardcoded Stripe secret was introduced.',
  score: 35,
  findings: [
    {
      id: 'f-secret',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      confidence: 0.96,
      kind: 'finding',
    },
    {
      id: 'f-phantom',
      severity: 'WARNING',
      category: 'bug',
      title: 'Phantom finding',
      file: 'src/config.ts',
      start_line: 999,
      end_line: 999,
      rationale: 'Not in the diff.',
      confidence: 0.4,
      kind: 'finding',
    },
  ],
};

describe('agent-runner local slice', () => {
  it('loads the agent manifest + skills from the .devdigest layout', async () => {
    const { manifest, skillBodies, missingSkills } = await loadAgent(
      join(FIX, 'agents', 'security-reviewer.yaml'),
      join(FIX, 'skills'),
    );
    expect(manifest.name).toBe('security-reviewer');
    expect(manifest.provider).toBe('openrouter');
    expect(manifest.strategy).toBe('auto');
    expect(missingSkills).toHaveLength(0);
    expect(skillBodies[0]).toContain('secret-gate');
  });

  it('reviews the fixture diff end-to-end (parse → engine → grounding)', async () => {
    const diff = parseUnifiedDiff(await readFile(join(FIX, 'sample.diff'), 'utf8'));
    expect(diff.files[0]!.path).toBe('src/config.ts');

    const { manifest, skillBodies } = await loadAgent(
      join(FIX, 'agents', 'security-reviewer.yaml'),
      join(FIX, 'skills'),
    );
    const outcome = await reviewPullRequest({
      systemPrompt: manifest.system_prompt,
      model: manifest.model,
      strategy: manifest.strategy,
      diff,
      llm: new MockLLMProvider(CANNED),
      skills: skillBodies,
      task: 'Review the fixture diff.',
    });

    // grounding kept the line-11 secret, dropped the line-999 phantom
    expect(outcome.grounding).toBe('1/2 passed');
    expect(outcome.review.findings).toHaveLength(1);
    expect(outcome.review.findings[0]!.start_line).toBe(11);
    expect(outcome.dropped).toHaveLength(1);
  });
});
