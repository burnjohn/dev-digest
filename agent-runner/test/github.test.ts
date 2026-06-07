import { describe, it, expect, vi } from 'vitest';
import type { GitHubReviewPayload } from '@devdigest/shared';
import { OctokitRunnerGitHub } from '../src/github.js';

/**
 * createReview must always land a review. GitHub returns 422 in two recoverable
 * cases: (1) you can't APPROVE/REQUEST_CHANGES your own PR, (2) an inline comment
 * targets a line GitHub can't resolve ("Line could not be resolved"), which
 * rejects the whole review. The layered fallback covers both.
 */

function err422(): Error {
  return Object.assign(new Error('Unprocessable Entity'), { status: 422 });
}

/** Build a runner whose octokit createReview is driven by `impl`, and return both. */
function runnerWith(impl: (args: Record<string, unknown>) => Promise<{ data: { id: number } }>) {
  const createReview = vi.fn(impl);
  const gh = new OctokitRunnerGitHub('token');
  // Inject a fake octokit (no network).
  (gh as unknown as { octokit: unknown }).octokit = { rest: { pulls: { createReview } } };
  return { gh, createReview };
}

const payload: GitHubReviewPayload = {
  body: '## DevDigest Review\n\n- finding',
  event: 'COMMENT',
  comments: [{ path: 'src/x.ts', line: 12, body: 'c' }],
};

describe('OctokitRunnerGitHub.createReview — 422 fallbacks', () => {
  it('posts with inline comments on the happy path', async () => {
    const { gh, createReview } = runnerWith(async () => ({ data: { id: 1 } }));
    const res = await gh.createReview('o', 'r', 3, payload);
    expect(res.id).toBe('1');
    expect(createReview).toHaveBeenCalledTimes(1);
    expect(createReview.mock.calls[0]![0]).toMatchObject({ comments: payload.comments });
  });

  it('own-PR 422 → retries as COMMENT, keeping the inline comments', async () => {
    const { gh, createReview } = runnerWith(async (args) => {
      if (args.event === 'REQUEST_CHANGES') throw err422();
      return { data: { id: 2 } };
    });
    const res = await gh.createReview('o', 'r', 3, { ...payload, event: 'REQUEST_CHANGES' });
    expect(res.id).toBe('2');
    expect(createReview).toHaveBeenCalledTimes(2);
    // second attempt still carries the comments
    expect(createReview.mock.calls[1]![0]).toMatchObject({ event: 'COMMENT', comments: payload.comments });
  });

  it('"Line could not be resolved" 422 → retries body-only (comments dropped)', async () => {
    const { gh, createReview } = runnerWith(async (args) => {
      if (args.comments) throw err422(); // any attempt that includes comments is rejected
      return { data: { id: 3 } };
    });
    const res = await gh.createReview('o', 'r', 3, payload);
    expect(res.id).toBe('3');
    expect(createReview).toHaveBeenCalledTimes(3);
    // final attempt has no comments key
    expect(createReview.mock.calls[2]![0]).not.toHaveProperty('comments');
  });

  it('rethrows non-422 errors', async () => {
    const boom = Object.assign(new Error('nope'), { status: 500 });
    const { gh } = runnerWith(async () => {
      throw boom;
    });
    await expect(gh.createReview('o', 'r', 3, payload)).rejects.toThrow('nope');
  });
});
