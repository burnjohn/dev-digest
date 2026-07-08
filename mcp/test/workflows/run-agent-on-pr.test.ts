import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  makePrMeta,
  makeRunSummary,
  makeReviewRecord,
  makeReviewRunResponse,
  makeFinding,
  makeOk,
  makeErr,
  getResultText,
} from '../setup.js';

vi.mock('../../src/api-client.js', () => ({
  fetchAgents: vi.fn(),
  fetchRepoPulls: vi.fn(),
  postReview: vi.fn(),
  fetchRuns: vi.fn(),
  fetchReviews: vi.fn(),
  fetchConventions: vi.fn(),
  fetchBrief: vi.fn(),
  enrichMessage: vi.fn((code: string, message: string) => message),
}));

import { runAgentOnPr } from '../../src/workflows/run-agent-on-pr.js';
import * as apiClient from '../../src/api-client.js';

const fetchRepoPullsMock = vi.mocked(apiClient.fetchRepoPulls);
const postReviewMock = vi.mocked(apiClient.postReview);
const fetchRunsMock = vi.mocked(apiClient.fetchRuns);
const fetchReviewsMock = vi.mocked(apiClient.fetchReviews);

const REPO_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const PR_ID = 'bbbbbbbb-0000-4000-8000-000000000002';
const AGENT_ID = 'cccccccc-0000-4000-8000-000000000003';
const RUN_ID = 'dddddddd-0000-4000-8000-000000000004';

// Standard args used across most tests
const ARGS = { repo_id: REPO_ID, pr_id: PR_ID, agent_id: AGENT_ID };

describe('runAgentOnPr workflow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('completes after 2 polls when first run is running then done', async () => {
    // Arrange
    const pr = makePrMeta({ id: PR_ID });
    fetchRepoPullsMock.mockResolvedValue(makeOk([pr]));
    postReviewMock.mockResolvedValue(makeOk(makeReviewRunResponse(RUN_ID)));

    const runRunning = makeRunSummary({ run_id: RUN_ID, status: 'running' });
    const runDone = makeRunSummary({ run_id: RUN_ID, status: 'done' });
    // First fetchRuns call → still running; second call → done
    fetchRunsMock
      .mockResolvedValueOnce(makeOk([runRunning]))
      .mockResolvedValueOnce(makeOk([runDone]));

    const review = makeReviewRecord({
      run_id: RUN_ID,
      verdict: 'approve',
      score: 90,
      findings: [makeFinding('SUGGESTION', '1')],
    });
    fetchReviewsMock.mockResolvedValue(makeOk([review]));

    // Act — start the workflow but don't await yet; use fake timers to drive it
    const resultPromise = runAgentOnPr(ARGS);

    // Advance past the first 2s polling delay → fetchRuns returns 'running'
    await vi.advanceTimersByTimeAsync(2001);
    // Advance past the second 2s polling delay → fetchRuns returns 'done'
    await vi.advanceTimersByTimeAsync(2001);

    const result = await resultPromise;

    // Assert
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(getResultText(result));
    expect(parsed.run_id).toBe(RUN_ID);
    expect(parsed.status).toBe('done');
    expect(parsed.verdict).toBe('approve');
    expect(parsed.score).toBe(90);
    expect(parsed).toHaveProperty('findings_breakdown');
    expect(parsed).toHaveProperty('top_findings');
    expect(fetchRunsMock).toHaveBeenCalledTimes(2);
  });

  it('returns isError:true with timeout message when fetchRuns never reaches done', async () => {
    // Arrange — fetchRuns always returns 'running'
    const pr = makePrMeta({ id: PR_ID });
    fetchRepoPullsMock.mockResolvedValue(makeOk([pr]));
    postReviewMock.mockResolvedValue(makeOk(makeReviewRunResponse(RUN_ID)));

    const runRunning = makeRunSummary({ run_id: RUN_ID, status: 'running' });
    fetchRunsMock.mockResolvedValue(makeOk([runRunning]));

    // Act — start the workflow
    const resultPromise = runAgentOnPr(ARGS);

    // Drive polling for a while (several 2s intervals)
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(2001);
    }
    // Now jump past the 120_000ms mark so withTimeout fires
    await vi.advanceTimersByTimeAsync(120_000);

    const result = await resultPromise;

    // Assert
    expect(result.isError).toBe(true);
    expect(getResultText(result)).toContain('timed out');
    expect(getResultText(result)).toContain('get_findings');
  });

  it('returns isError:true with disabled-agent hint when postReview returns empty runs', async () => {
    // Arrange — postReview returns a ReviewRunResponse with no runs
    const pr = makePrMeta({ id: PR_ID });
    fetchRepoPullsMock.mockResolvedValue(makeOk([pr]));
    postReviewMock.mockResolvedValue(
      makeOk({ pr_id: PR_ID, runs: [], reviews: [] }),
    );

    // Act — no timers needed; the error happens synchronously before any poll
    const resultPromise = runAgentOnPr(ARGS);
    // Flush microtasks / synchronous awaits
    await vi.advanceTimersByTimeAsync(0);
    const result = await resultPromise;

    // Assert
    expect(result.isError).toBe(true);
    expect(getResultText(result)).toContain('disabled');
  });

  it('returns isError:true with membership message when PR does not belong to repo', async () => {
    // Arrange — fetchRepoPulls returns pulls with different ids
    const otherPr = makePrMeta({ id: 'ffffffff-ffff-4fff-ffff-ffffffffffff' });
    fetchRepoPullsMock.mockResolvedValue(makeOk([otherPr]));

    // Act
    const resultPromise = runAgentOnPr(ARGS);
    await vi.advanceTimersByTimeAsync(0);
    const result = await resultPromise;

    // Assert
    expect(result.isError).toBe(true);
    expect(getResultText(result)).toContain(PR_ID);
    expect(getResultText(result)).toContain(REPO_ID);
    expect(getResultText(result)).toMatch(/does not belong/i);
  });

  it('returns isError:true when fetchRepoPulls itself fails', async () => {
    fetchRepoPullsMock.mockResolvedValue(
      makeErr('not_found', 'Repo not found; verify the repo_id is correct'),
    );

    const resultPromise = runAgentOnPr(ARGS);
    await vi.advanceTimersByTimeAsync(0);
    const result = await resultPromise;

    expect(result.isError).toBe(true);
    expect(getResultText(result)).toContain('repo_id');
  });
});
