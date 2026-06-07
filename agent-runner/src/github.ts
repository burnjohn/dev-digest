import { Octokit } from 'octokit';
import type { GitHubReviewPayload } from '@devdigest/shared';
import type { ChangedFile } from './diff.js';

/**
 * The slice of GitHub the runner needs: read a PR's changed files (with hunk
 * patches) and post a review. Kept as an interface so the orchestration is unit-
 * testable with a mock — no network in tests.
 */
export interface RunnerGitHub {
  getChangedFiles(owner: string, repo: string, prNumber: number): Promise<ChangedFile[]>;
  createReview(
    owner: string,
    repo: string,
    prNumber: number,
    payload: GitHubReviewPayload,
  ): Promise<{ id: string }>;
}

/** Real Octokit-backed client (PAT / GITHUB_TOKEN). */
export class OctokitRunnerGitHub implements RunnerGitHub {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async getChangedFiles(owner: string, repo: string, prNumber: number): Promise<ChangedFile[]> {
    const files = await this.octokit.paginate(this.octokit.rest.pulls.listFiles, {
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    });
    return files.map((f) => ({ path: f.filename, patch: f.patch ?? null }));
  }

  async createReview(
    owner: string,
    repo: string,
    prNumber: number,
    payload: GitHubReviewPayload,
  ): Promise<{ id: string }> {
    const comments = payload.comments?.map((c) => ({ path: c.path, line: c.line, body: c.body }));
    const submit = (event: GitHubReviewPayload['event']) =>
      this.octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        body: payload.body,
        event,
        comments,
      });
    try {
      const res = await submit(payload.event);
      return { id: String(res.data.id) };
    } catch (err) {
      // GitHub forbids APPROVE / REQUEST_CHANGES on your OWN pull request (422).
      // In the course model (you review your own fork's PR), fall back to a
      // COMMENT review so the findings still land.
      const status = (err as { status?: number }).status;
      if (status === 422 && payload.event !== 'COMMENT') {
        const res = await submit('COMMENT');
        return { id: String(res.data.id) };
      }
      throw err;
    }
  }
}

/** In-memory mock for tests: canned changed files + records posted reviews. */
export class MockRunnerGitHub implements RunnerGitHub {
  posted: { owner: string; repo: string; prNumber: number; payload: GitHubReviewPayload }[] = [];

  constructor(private files: ChangedFile[] = []) {}

  async getChangedFiles(): Promise<ChangedFile[]> {
    return this.files;
  }

  async createReview(
    owner: string,
    repo: string,
    prNumber: number,
    payload: GitHubReviewPayload,
  ): Promise<{ id: string }> {
    this.posted.push({ owner, repo, prNumber, payload });
    return { id: `mock-review-${prNumber}` };
  }
}
