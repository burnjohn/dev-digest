import { describe, it, expect } from 'vitest';
import { MockLLMProvider } from '../../adapters/mocks.js';
import { EvalExecutor, buildArms } from './executor.js';
import type { AgentRecord, LinkedSkillForRun } from './ports.js';

const agent: AgentRecord = {
  id: 'agent-1',
  name: 'Security Reviewer',
  provider: 'openai',
  model: 'gpt-4o-mini',
  systemPrompt: 'Review the diff for security issues.',
  strategy: 'single-pass',
  version: 3,
};

const inputDiff =
  'diff --git a/src/config.ts b/src/config.ts\n' +
  '--- a/src/config.ts\n' +
  '+++ b/src/config.ts\n' +
  '@@ -10,3 +10,4 @@\n' +
  '   port: 3000,\n' +
  '+  stripeKey: "sk_live_xxx",\n' +
  '   redisUrl: x,';

const inputMeta = { pr_number: 491, title: 'Fix session token handling', body: 'A description.' };

function fixtureReview() {
  return {
    verdict: 'comment' as const,
    summary: 'looks fine',
    score: 80,
    findings: [
      {
        id: 'f1',
        severity: 'WARNING' as const,
        category: 'security' as const,
        title: 'Hardcoded key',
        file: 'src/config.ts',
        start_line: 12,
        end_line: 12,
        rationale: 'x',
        confidence: 0.9,
      },
    ],
  };
}

describe('EvalExecutor.runCase — AC-8, AC-9, AC-10', () => {
  it('AC-8 — executes the agent against the case frozen diff and returns grounded findings', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixtureReview() });
    const executor = new EvalExecutor();
    const result = await executor.runCase(agent, [], llm, { inputDiff, inputMeta });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.file).toBe('src/config.ts');
    expect(result.groundingKept).toBe(1);
    expect(result.groundingTotal).toBe(1);
    expect(result.tokensIn).toBeGreaterThan(0);
  });

  it('AC-9 — the assembled prompt contains no repo map, callers, intent or live PR description sections that were never supplied', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixtureReview() });
    const executor = new EvalExecutor();
    // inputMeta.body is set (frozen PR metadata IS allowed — D9), but repo
    // map/callers/intent are never even accepted as inputs by this path.
    const result = await executor.runCase(agent, [], llm, { inputDiff, inputMeta });
    expect(result.assembly.repo_map).toBeFalsy();
    expect(result.assembly.callers).toBeFalsy();
    expect(result.assembly.intent).toBeFalsy();
    expect(result.assembly.intent_scope).toBeFalsy();
    expect(result.assembly.specs).toBeFalsy();
    expect(result.assembly.memory).toBeFalsy();
  });

  it('AC-9 — the frozen PR description IS included (D9 keeps prompt parity, minus the live-only slots)', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixtureReview() });
    const executor = new EvalExecutor();
    const result = await executor.runCase(agent, [], llm, { inputDiff, inputMeta });
    expect(result.assembly.pr_description).toContain('A description.');
  });

  it('AC-10 — assembling the same case twice with no config change is byte-identical', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixtureReview() });
    const executor = new EvalExecutor();
    const a = await executor.runCase(agent, [], llm, { inputDiff, inputMeta });
    const b = await executor.runCase(agent, [], llm, { inputDiff, inputMeta });
    expect(JSON.stringify(a.assembly)).toBe(JSON.stringify(b.assembly));
  });
});

// =============================================================================
// specs/15-skill-eval-cases.md §5 — buildArms (AC-16, D7, D8)
// =============================================================================

const skillUnderTest = {
  id: 'skill-1',
  name: 'secret-leakage-gate',
  type: 'security' as const,
  body: 'Flag secrets — sk_live_ prefix.',
};

function link(overrides: Partial<LinkedSkillForRun> & Pick<LinkedSkillForRun, 'id' | 'order'>): LinkedSkillForRun {
  return {
    name: overrides.id,
    type: 'rubric',
    body: 'body',
    linkEnabled: true,
    skillEnabled: true,
    ...overrides,
  };
}

describe('buildArms — AC-16, D8 (the gate-bypass trap)', () => {
  it('D8 — the with-arm splices in the skill under test even when it is disabled by BOTH gates, so the arms are never identical', () => {
    const carrierLinks: LinkedSkillForRun[] = [
      link({ id: 'skill-1', name: 'secret-leakage-gate', order: 1, linkEnabled: false, skillEnabled: false }),
      link({ id: 'skill-2', name: 'pr-quality-rubric', order: 0 }),
    ];
    const { withArm, withoutArm } = buildArms(carrierLinks, skillUnderTest, 1);

    expect(withoutArm.map((s) => s.name)).toEqual(['pr-quality-rubric']);
    expect(withArm.map((s) => s.name)).toEqual(['pr-quality-rubric', 'secret-leakage-gate']);
    // The single most dangerous possible failure mode this test guards
    // against: a disabled skill silently producing two identical arms (a
    // lift of exactly 0.0 that looks like a real, measured result).
    expect(withArm).not.toEqual(withoutArm);
  });

  it('appends the skill under test when no link exists at all (linkOrder null)', () => {
    const carrierLinks: LinkedSkillForRun[] = [link({ id: 'skill-2', name: 'pr-quality-rubric', order: 0 })];
    const { withArm, withoutArm } = buildArms(carrierLinks, skillUnderTest, null);
    expect(withArm.map((s) => s.name)).toEqual(['pr-quality-rubric', 'secret-leakage-gate']);
    expect(withoutArm.map((s) => s.name)).toEqual(['pr-quality-rubric']);
  });

  it('ordering — the with-arm keeps every OTHER block in identical relative order, since it is built FROM the without-arm', () => {
    const carrierLinks: LinkedSkillForRun[] = [
      link({ id: 'a', name: 'skill-a', order: 0 }),
      link({ id: 'skill-1', name: 'secret-leakage-gate', order: 1 }),
      link({ id: 'b', name: 'skill-b', order: 2 }),
      link({ id: 'c', name: 'skill-c', order: 3 }),
    ];
    const { withArm, withoutArm } = buildArms(carrierLinks, skillUnderTest, 1);
    expect(withoutArm.map((s) => s.name)).toEqual(['skill-a', 'skill-b', 'skill-c']);
    // Spliced back in at its own order position — the OTHER blocks' relative
    // order (a, b, c) is unchanged either side of the splice.
    expect(withArm.map((s) => s.name)).toEqual(['skill-a', 'secret-leakage-gate', 'skill-b', 'skill-c']);
  });

  it('a disabled OTHER skill still respects its own two-gate rule and is excluded from BOTH arms', () => {
    const carrierLinks: LinkedSkillForRun[] = [
      link({ id: 'a', name: 'skill-a', order: 0, linkEnabled: false }),
      link({ id: 'skill-1', name: 'secret-leakage-gate', order: 1 }),
    ];
    const { withArm, withoutArm } = buildArms(carrierLinks, skillUnderTest, 1);
    expect(withoutArm.map((s) => s.name)).toEqual([]);
    expect(withArm.map((s) => s.name)).toEqual(['secret-leakage-gate']);
  });
});

describe('EvalExecutor.runCase + buildArms — AC-16, the load-bearing invariant', () => {
  it('the two arms’ PromptAssembly objects differ ONLY by this skill’s own block', async () => {
    const carrierLinks: LinkedSkillForRun[] = [link({ id: 'other', name: 'pr-quality-rubric', order: 0 })];
    const { withArm, withoutArm } = buildArms(carrierLinks, skillUnderTest, null);

    const llm = new MockLLMProvider('openai', { structured: fixtureReview() });
    const executor = new EvalExecutor();
    const withResult = await executor.runCase(agent, withArm, llm, { inputDiff, inputMeta });
    const withoutResult = await executor.runCase(agent, withoutArm, llm, { inputDiff, inputMeta });

    // `user` also carries a rendered copy of the skills section (prompt.ts
    // folds `skills` into the composed user message too) — so BOTH `skills`
    // and `user` are expected to differ, and every OTHER slot (system,
    // pr_description, callers, repo_map, intent, intent_scope, memory) must
    // be byte-identical.
    const { skills: withSkills, user: withUser, ...withRest } = withResult.assembly;
    const { skills: withoutSkills, user: withoutUser, ...withoutRest } = withoutResult.assembly;
    expect(withRest).toEqual(withoutRest);

    // The skills slot differs by exactly the skill-under-test's own rendered
    // block, appended after the without-arm's skills text.
    const addedBlock = '\n\n### Skill: secret-leakage-gate (security)\nFlag secrets — sk_live_ prefix.';
    expect(withSkills).toBe(`${withoutSkills}${addedBlock}`);

    // The user message differs by exactly that same appended block, nowhere
    // else — stripping it out of the with-arm's user text reproduces the
    // without-arm's user text byte-for-byte.
    expect(withUser.replace(addedBlock, '')).toBe(withoutUser);
    expect(withUser).not.toBe(withoutUser);
  });
});
