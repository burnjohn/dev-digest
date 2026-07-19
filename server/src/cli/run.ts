import type { LLMProvider } from '@devdigest/shared';
import { reviewPullRequest, countBlockers } from '@devdigest/reviewer-core';
import { parseUnifiedDiff } from '../adapters/git/diff-parser.js';
import { getDiff, type GitRunner, type ReviewMode } from './diff.js';
import { renderReview } from './render.js';

export interface CliDeps {
  mode: ReviewMode;
  /** Base ref for `--mode branch`. */
  base?: string;
  runGit: GitRunner;
  /**
   * The SAME Structured Reviewer used on the PR page — an LLMProvider consumed
   * by reviewPullRequest. Built lazily (only when there IS a diff) so an empty
   * working tree spends ZERO tokens.
   */
  makeLlm: () => Promise<LLMProvider>;
  /** Default agent's system prompt (reuse the product's General reviewer). */
  systemPrompt: string;
  model: string;
  color?: boolean;
  /** Output sink (default process.stdout.write); injected in tests. */
  write: (s: string) => void;
}

export interface CliResult {
  /** Process exit code — non-zero when a blocker (CRITICAL) is found, so the
      command is usable as a `pre-push` git hook. */
  exitCode: number;
  /** How many LLM calls were made (0 for an empty diff). Asserted in tests. */
  llmCalls: number;
  findingsCount: number;
}

/**
 * `devdigest review --mode working` — pre-push review of the working copy.
 *
 * Reuses the exact PR-review engine (@devdigest/reviewer-core `reviewPullRequest`)
 * from a NEW entry point: get the local `git diff` → feed the same Structured
 * Reviewer → print the same grounded findings to the terminal. No server, no DB,
 * no GitHub. The only difference from the UI path is where the diff comes from
 * and where the findings go.
 */
export async function runReviewCli(deps: CliDeps): Promise<CliResult> {
  const raw = await getDiff(deps.mode, deps.runGit, deps.base);

  // Empty working tree → explicit empty state, and crucially NO model call.
  if (raw.trim() === '') {
    deps.write(`DevDigest review — ${deps.mode} tree\nNothing to review — the ${deps.mode} tree is clean.\n`);
    return { exitCode: 0, llmCalls: 0, findingsCount: 0 };
  }

  const diff = parseUnifiedDiff(raw);
  if (diff.files.length === 0) {
    deps.write(`DevDigest review — ${deps.mode} tree\nNo reviewable code changes in the ${deps.mode} tree.\n`);
    return { exitCode: 0, llmCalls: 0, findingsCount: 0 };
  }

  const llm = await deps.makeLlm();
  const outcome = await reviewPullRequest({
    systemPrompt: deps.systemPrompt,
    model: deps.model,
    diff,
    llm,
    task: `Review the working-copy changes (${diff.files.length} file(s)) before push`,
  });

  deps.write(renderReview(outcome.review, { mode: deps.mode, color: deps.color }));

  const blockers = countBlockers(outcome.review.findings, 'critical');
  // chunks = the engine's LLM calls (single-pass → 1, map-reduce → N).
  return {
    exitCode: blockers > 0 ? 1 : 0,
    llmCalls: outcome.chunks.length,
    findingsCount: outcome.review.findings.length,
  };
}
