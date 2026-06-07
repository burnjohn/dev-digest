import { join } from 'node:path';
import { loadAgent } from './manifest.js';
import { OctokitRunnerGitHub } from './github.js';
import { OpenRouterProvider } from './llm.js';
import { reviewAndPost, type PostMode } from './review-pr.js';

/**
 * Manual CLI for running ONE agent against a real PR outside CI (env-driven).
 * Useful for a live smoke test before publishing the Action. The GitHub Action
 * itself uses main.ts; this file is never bundled by ncc.
 *
 *   GITHUB_TOKEN=… OPENROUTER_API_KEY=… GITHUB_REPOSITORY=acme/payments-api \
 *   PR_NUMBER=482 npx tsx src/review-cli.ts
 */

function parseRepo(slug: string | undefined): { owner: string; repo: string } {
  const [owner, repo] = (slug ?? '').split('/');
  if (!owner || !repo) throw new Error('Set GITHUB_REPOSITORY="owner/name".');
  return { owner, repo };
}

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const orKey = process.env.OPENROUTER_API_KEY;
  if (!token) throw new Error('GITHUB_TOKEN is required to read the PR and post the review.');
  if (!orKey) throw new Error('OPENROUTER_API_KEY is required for the LLM.');

  const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);
  const prNumber = Number(process.env.PR_NUMBER ?? process.argv[2]);
  if (!Number.isInteger(prNumber)) throw new Error('Set PR_NUMBER (or pass it as an argument).');

  const root = process.env.DEVDIGEST_DIR ?? '.devdigest';
  const slug = process.env.AGENT ?? 'security-reviewer';
  const agent = await loadAgent(join(root, 'agents', `${slug}.yaml`), join(root, 'skills'));
  if (process.env.MODEL) agent.manifest.model = process.env.MODEL; // MODEL env overrides the manifest
  if (process.env.STRATEGY) {
    agent.manifest.strategy = process.env.STRATEGY as typeof agent.manifest.strategy; // single-pass | map-reduce | auto
  }
  if (agent.missingSkills.length > 0) {
    console.warn(`  ! missing skill(s): ${agent.missingSkills.join(', ')}`);
  }

  const result = await reviewAndPost({
    github: new OctokitRunnerGitHub(token),
    llm: new OpenRouterProvider(orKey),
    agent,
    owner,
    repo,
    prNumber,
    post: (process.env.POST as PostMode) ?? 'github-review',
    sessionId: process.env.SESSION_ID, // undefined → reviewAndPost default (owner/repo#pr:agent)
    onEvent: (e) => console.log(`  [${e.kind}] ${e.msg}`),
  });

  console.log(
    `\n${result.outcome.review.verdict} · ${result.outcome.grounding} · ` +
      `${result.outcome.review.findings.length} finding(s)` +
      (result.posted ? ` · posted ${result.posted.id}` : ' · not posted'),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
