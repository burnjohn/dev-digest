import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import { parseUnifiedDiff } from './diff.js';
import { loadAgent } from './manifest.js';
import { OpenRouterProvider, MockLLMProvider } from './llm.js';

/**
 * M1 dev-harness: review a fixture diff with ONE agent and print findings — the
 * vertical slice through reviewer-core with NO GitHub. Uses OpenRouter when
 * OPENROUTER_API_KEY is set, otherwise an offline canned review so the slice is
 * runnable (and testable) without network.
 *
 *   OPENROUTER_API_KEY=… pnpm --filter @devdigest/agent-runner local   # real
 *   pnpm --filter @devdigest/agent-runner local                        # offline
 */

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, '..', 'fixtures');

/** Canned review for the offline path: one grounded finding (line 11 of the
 *  fixture diff) + one hallucinated finding (line 999) the gate must drop. */
const CANNED_REVIEW = {
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
      rationale: 'A live Stripe key (sk_live_…) is committed in source.',
      suggestion: 'Move it to an environment variable / secret store.',
      confidence: 0.96,
      kind: 'finding',
    },
    {
      id: 'f-phantom',
      severity: 'WARNING',
      category: 'bug',
      title: 'Phantom finding on a line not in the diff',
      file: 'src/config.ts',
      start_line: 999,
      end_line: 999,
      rationale: 'This line is not part of the diff.',
      confidence: 0.4,
      kind: 'finding',
    },
  ],
};

export async function runLocal(): Promise<void> {
  const diffRaw = await readFile(join(FIXTURES, 'sample.diff'), 'utf8');
  const diff = parseUnifiedDiff(diffRaw);

  const { manifest, skillBodies, missingSkills } = await loadAgent(
    join(FIXTURES, 'agents', 'security-reviewer.yaml'),
    join(FIXTURES, 'skills'),
  );
  if (missingSkills.length > 0) {
    console.warn(`  ! ${missingSkills.length} skill(s) not found: ${missingSkills.join(', ')}`);
  }

  const key = process.env.OPENROUTER_API_KEY;
  const model = process.env.MODEL || manifest.model; // MODEL env overrides the manifest
  const llm = key ? new OpenRouterProvider(key) : new MockLLMProvider(CANNED_REVIEW);
  console.log(
    key
      ? `→ OpenRouter — agent "${manifest.name}" (${model})`
      : `→ Mock LLM (offline; set OPENROUTER_API_KEY to use ${model})`,
  );

  const outcome = await reviewPullRequest({
    systemPrompt: manifest.system_prompt,
    model,
    strategy: manifest.strategy,
    diff,
    llm,
    skills: skillBodies,
    task: `Review the fixture diff with agent "${manifest.name}".`,
    sessionId: process.env.SESSION_ID ?? `local/fixture:${manifest.name}`,
    onEvent: (e) => console.log(`  [${e.kind}] ${e.msg}`),
  });

  console.log('\n── Result ───────────────────────────────');
  console.log(`mode:      ${outcome.mode}`);
  console.log(`verdict:   ${outcome.review.verdict}  score: ${outcome.review.score}`);
  console.log(`grounding: ${outcome.grounding}  (dropped ${outcome.dropped.length})`);
  console.log(`tokens:    in=${outcome.tokensIn} out=${outcome.tokensOut}  cost=${outcome.costUsd ?? 'n/a'}`);
  console.log(`findings (${outcome.review.findings.length}):`);
  for (const f of outcome.review.findings) {
    console.log(`  • [${f.severity}] ${f.file}:${f.start_line}-${f.end_line}  ${f.title}`);
  }
  if (outcome.dropped.length > 0) {
    console.log('dropped by grounding:');
    for (const d of outcome.dropped) console.log(`  ✗ ${d.finding.title} — ${d.reason}`);
  }
}

// Run when invoked directly (tsx src/local.ts), not when imported by a test.
if (import.meta.url === `file://${process.argv[1]}`) {
  runLocal().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
