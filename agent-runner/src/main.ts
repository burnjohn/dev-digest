import * as core from '@actions/core';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { CiResultArtifact, Finding } from '@devdigest/shared';
import { loadAgent } from './manifest.js';
import { OctokitRunnerGitHub } from './github.js';
import { OpenRouterProvider } from './llm.js';
import { reviewAndPost, type PostMode } from './review-pr.js';

/**
 * GitHub Action entrypoint (bundled to dist/index.js by ncc). Resolves which
 * agents to run from `.devdigest/agents`, reviews the PR with each (sequential
 * for now), posts the reviews, and writes `devdigest-result.json` — the artifact
 * the studio ingests (CiService.ingest → ci_runs).
 */

const ARTIFACT_FILE = 'devdigest-result.json';

/** PR number from the triggering `pull_request` event payload. */
async function prNumberFromEvent(): Promise<number | null> {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) return null;
  try {
    const ev = JSON.parse(await readFile(path, 'utf8')) as { pull_request?: { number?: number } };
    return ev.pull_request?.number ?? null;
  } catch {
    return null;
  }
}

/** Decide which agent slugs to run: `all` globs the dir, else the given slug(s). */
export async function resolveAgentSlugs(opts: {
  agent?: string;
  agents?: string[];
  all?: boolean;
  agentsDir: string;
}): Promise<string[]> {
  if (opts.all) {
    const files = await readdir(opts.agentsDir);
    return files
      .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
      .map((f) => f.replace(/\.(ya?ml)$/, ''))
      .sort();
  }
  const list = (opts.agents ?? []).filter(Boolean);
  if (list.length > 0) return list;
  if (opts.agent) return [opts.agent];
  throw new Error('Provide one of the inputs: `agent`, `agents`, or `all: true`.');
}

/** Aggregate per-agent findings into the single CiResultArtifact the studio ingests. */
export function buildArtifact(
  parts: { agent: string; findings: Finding[]; costUsd: number | null; durationMs: number }[],
  prNumber: number | null,
): CiResultArtifact {
  const all = parts.flatMap((p) => p.findings);
  const bySev = (s: string) => all.filter((f) => f.severity === s).length;
  const cost = parts.reduce<number | null>(
    (n, p) => (n == null || p.costUsd == null ? null : n + p.costUsd),
    0,
  );
  return {
    findings_count: all.length,
    critical: bySev('CRITICAL'),
    warning: bySev('WARNING'),
    suggestion: bySev('SUGGESTION'),
    cost_usd: cost,
    duration_ms: parts.reduce((n, p) => n + p.durationMs, 0),
    agent: parts.map((p) => p.agent).join(','),
    version: '1',
    pr_number: prNumber,
  };
}

export async function run(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const orKey = process.env.OPENROUTER_API_KEY;
  if (!token) throw new Error('GITHUB_TOKEN is not set (needs `permissions: pull-requests: write`).');
  if (!orKey) throw new Error('OPENROUTER_API_KEY is not set (add it to repo Actions secrets).');

  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
  if (!owner || !repo) throw new Error('GITHUB_REPOSITORY is not set ("owner/name").');

  const prNumber = await prNumberFromEvent();
  if (prNumber == null) {
    core.info('No pull_request found in the event payload — nothing to review.');
    return;
  }

  const root = core.getInput('devdigest-dir') || '.devdigest';
  const agentsDir = join(root, 'agents');
  const skillsDir = join(root, 'skills');
  const post = (core.getInput('post') || 'github-review') as PostMode;

  const slugs = await resolveAgentSlugs({
    agent: core.getInput('agent') || undefined,
    agents: core.getMultilineInput('agents'),
    all: core.getBooleanInput('all'),
    agentsDir,
  });
  core.info(`Running ${slugs.length} agent(s): ${slugs.join(', ')} on ${owner}/${repo}#${prNumber}`);

  const github = new OctokitRunnerGitHub(token);
  const llm = new OpenRouterProvider(orKey);

  const parts: { agent: string; findings: Finding[]; costUsd: number | null; durationMs: number }[] = [];
  // Agents whose review tripped the CI gate (event === REQUEST_CHANGES) — these
  // fail the check after the artifact is written (see `ci_fail_on` policy).
  const blocking: string[] = [];
  for (const slug of slugs) {
    const agent = await loadAgent(join(agentsDir, `${slug}.yaml`), skillsDir);
    if (agent.missingSkills.length > 0) {
      core.warning(`[${slug}] missing skill(s): ${agent.missingSkills.join(', ')}`);
    }
    const t0 = Date.now();
    const result = await reviewAndPost({
      github,
      llm,
      agent,
      owner,
      repo,
      prNumber,
      post,
      sessionId: process.env.SESSION_ID, // undefined → owner/repo#pr:agent
      onEvent: (e) => core.info(`[${slug}] ${e.msg}`),
    });
    parts.push({
      agent: agent.manifest.name,
      findings: result.outcome.review.findings,
      costUsd: result.outcome.costUsd,
      durationMs: Date.now() - t0,
    });
    if (result.payload.event === 'REQUEST_CHANGES') blocking.push(agent.manifest.name);
  }

  const artifact = buildArtifact(parts, prNumber);
  await writeFile(ARTIFACT_FILE, JSON.stringify(artifact, null, 2));
  core.setOutput('findings', String(artifact.findings_count));
  core.setOutput('result-path', ARTIFACT_FILE);
  core.info(
    `Done — ${artifact.findings_count} finding(s) across ${slugs.length} agent(s); wrote ${ARTIFACT_FILE}.`,
  );

  // Fail the check (red ✗) only when an agent's gate tripped — `ci_fail_on`
  // decides this deterministically from severities. The artifact is already
  // written and the review posted; upload-artifact runs with `if: always()`.
  if (blocking.length > 0) {
    core.setFailed(
      `Changes requested by ${blocking.length} agent(s): ${blocking.join(', ')} (ci_fail_on gate).`,
    );
  }
}

// Run only when executed as the action entry (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((err) => core.setFailed(err instanceof Error ? err.message : String(err)));
}
