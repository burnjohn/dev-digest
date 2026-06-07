import type { LLMProvider } from '@devdigest/shared';
import { reviewPullRequest, toReviewPayload, type ReviewEvent } from '@devdigest/reviewer-core';
import { filesToUnifiedDiff } from './diff.js';
import { type LoadedAgent } from './manifest.js';
import { type RunnerGitHub } from './github.js';

/**
 * M2 orchestration (library, no process/env): pull a PR's diff from GitHub
 * (listFiles patches, no clone), run the reviewer-core engine, turn the grounded
 * review into a GitHub review payload, and optionally post it. Unit-testable
 * with a MockRunnerGitHub + MockLLMProvider. The Action entry (main.ts) and the
 * manual CLI (review-cli.ts) both call this.
 */

export type PostMode = 'github-review' | 'none';

export interface ReviewAndPostInput {
  github: RunnerGitHub;
  llm: LLMProvider;
  agent: LoadedAgent;
  owner: string;
  repo: string;
  prNumber: number;
  post?: PostMode;
  inline?: boolean;
  /** OpenRouter session id; defaults to `owner/repo#pr:agent` (one review = one session). */
  sessionId?: string;
  onEvent?: (e: ReviewEvent) => void;
}

export interface ReviewAndPostResult {
  outcome: Awaited<ReturnType<typeof reviewPullRequest>>;
  payload: ReturnType<typeof toReviewPayload>;
  posted: { id: string } | null;
  /** Files GitHub returned without a patch (binary / truncated) — never silent. */
  skipped: string[];
}

export async function reviewAndPost(input: ReviewAndPostInput): Promise<ReviewAndPostResult> {
  const { github, llm, agent, owner, repo, prNumber } = input;
  const post = input.post ?? 'github-review';
  const sessionId = input.sessionId ?? `${owner}/${repo}#${prNumber}:${agent.manifest.name}`;
  const log = (e: ReviewEvent) => input.onEvent?.(e);

  const files = await github.getChangedFiles(owner, repo, prNumber);
  const { diff, skipped } = filesToUnifiedDiff(files);
  if (skipped.length > 0) {
    // "Never go silent": these files can't be grounded; say so explicitly.
    log({
      kind: 'info',
      msg: `${skipped.length} file(s) had no patch (binary/too large), skipped: ${skipped.join(', ')}`,
    });
  }

  const outcome = await reviewPullRequest({
    systemPrompt: agent.manifest.system_prompt,
    model: agent.manifest.model,
    strategy: agent.manifest.strategy,
    diff,
    llm,
    skills: agent.skillBodies,
    task: `Review pull request #${prNumber} in ${owner}/${repo} with agent "${agent.manifest.name}".`,
    sessionId,
    onEvent: log,
  });

  const payload = toReviewPayload(outcome.review, {
    inline: input.inline ?? true,
    failOn: agent.manifest.ci_fail_on,
    diff,
  });

  let posted: { id: string } | null = null;
  if (post === 'github-review') {
    posted = await github.createReview(owner, repo, prNumber, payload);
    log({
      kind: 'result',
      msg: `Posted review ${posted.id} (${payload.event}) with ${payload.comments?.length ?? 0} inline comment(s)`,
    });
  }

  return { outcome, payload, posted, skipped };
}
