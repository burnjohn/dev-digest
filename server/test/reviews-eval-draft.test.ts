import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictError, NotFoundError } from '../src/platform/errors.js';
import { buildEvalDraft } from '../src/modules/reviews/eval-draft.js';
import { buildAgentCaseDiff } from '../src/modules/_shared/diff-synth.js';
import type { ReviewRepository, ReviewRow } from '../src/modules/reviews/repository.js';
import type { FindingRow, PullRow } from '../src/db/rows.js';

/**
 * Unit tests for `buildEvalDraft` — hermetic, no DB. Mirrors the
 * `actOnFinding` test style in `reviews-findings.test.ts`: a
 * `Partial<ReviewRepository>` mock, one `describe` per acceptance box.
 */

const PR_ID = 'pr-1';
const WORKSPACE_ID = 'ws-1';
const REVIEW_ID = 'review-1';
const FINDING_ID = 'finding-1';
const AGENT_ID = 'agent-1';
const FILE_PATH = 'src/db.ts';

function makePull(overrides: Partial<PullRow> = {}): PullRow {
  return {
    id: PR_ID,
    workspaceId: WORKSPACE_ID,
    repoId: 'repo-1',
    number: 42,
    title: 'Add feature',
    author: 'octocat',
    branch: 'feature',
    base: 'main',
    headSha: 'abc123',
    lastReviewedSha: null,
    additions: 10,
    deletions: 2,
    filesCount: 1,
    status: 'needs_review',
    body: null,
    openedAt: null,
    updatedAt: null,
    ...overrides,
  } as PullRow;
}

function makeReview(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    id: REVIEW_ID,
    workspaceId: WORKSPACE_ID,
    prId: PR_ID,
    agentId: AGENT_ID,
    runId: null,
    kind: 'review',
    verdict: null,
    summary: null,
    score: null,
    model: null,
    createdAt: new Date(),
    ...overrides,
  } as ReviewRow;
}

function makeFinding(overrides: Partial<FindingRow> = {}): FindingRow {
  return {
    id: FINDING_ID,
    reviewId: REVIEW_ID,
    severity: 'CRITICAL',
    category: 'security',
    title: 'SQL injection',
    file: FILE_PATH,
    startLine: 10,
    endLine: 14,
    rationale: 'User input is not escaped',
    suggestion: 'Use parameterized queries',
    confidence: 0.95,
    kind: 'finding',
    trifectaComponents: null,
    acceptedAt: null,
    dismissedAt: null,
    ...overrides,
  } as FindingRow;
}

const PATCH = '@@ -10,3 +10,4 @@\n-old\n+new';

function makePrFile(path = FILE_PATH, patch: string | null = PATCH) {
  return { id: 'file-1', prId: PR_ID, path, additions: 1, deletions: 1, patch };
}

describe('buildEvalDraft — GET /findings/:id/eval-draft', () => {
  let mockRepo: Partial<ReviewRepository>;

  beforeEach(() => {
    mockRepo = {
      findingContext: vi.fn(),
      getPrFiles: vi.fn(),
    };
  });

  it('REQ-40 — a finding in another workspace answers 404, never 403', async () => {
    mockRepo.findingContext = vi.fn().mockResolvedValue({
      finding: makeFinding(),
      review: makeReview(),
      pull: makePull({ workspaceId: 'other-ws' }),
    });

    await expect(
      buildEvalDraft(mockRepo as ReviewRepository, WORKSPACE_ID, FINDING_ID),
    ).rejects.toThrow(NotFoundError);
    expect(mockRepo.getPrFiles).not.toHaveBeenCalled();
  });

  it('answers 404 when the finding does not exist at all', async () => {
    mockRepo.findingContext = vi.fn().mockResolvedValue(undefined);

    await expect(
      buildEvalDraft(mockRepo as ReviewRepository, WORKSPACE_ID, FINDING_ID),
    ).rejects.toThrow(NotFoundError);
  });

  describe('REQ-3 — no stored diff', () => {
    it('answers 409 naming the reason when pr_files.patch is null', async () => {
      mockRepo.findingContext = vi.fn().mockResolvedValue({
        finding: makeFinding({ acceptedAt: new Date() }),
        review: makeReview(),
        pull: makePull(),
      });
      mockRepo.getPrFiles = vi.fn().mockResolvedValue([makePrFile(FILE_PATH, null)]);

      const error = await buildEvalDraft(
        mockRepo as ReviewRepository,
        WORKSPACE_ID,
        FINDING_ID,
      ).catch((e) => e);

      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).statusCode).toBe(409);
      expect((error as ConflictError).message).toContain(FILE_PATH);
    });

    it("answers 409 naming the reason when pr_files.patch is ''", async () => {
      mockRepo.findingContext = vi.fn().mockResolvedValue({
        finding: makeFinding({ acceptedAt: new Date() }),
        review: makeReview(),
        pull: makePull(),
      });
      mockRepo.getPrFiles = vi.fn().mockResolvedValue([makePrFile(FILE_PATH, '')]);

      await expect(
        buildEvalDraft(mockRepo as ReviewRepository, WORKSPACE_ID, FINDING_ID),
      ).rejects.toThrow(ConflictError);
    });

    it('answers 409 when no pr_files row matches the file at all', async () => {
      mockRepo.findingContext = vi.fn().mockResolvedValue({
        finding: makeFinding({ acceptedAt: new Date() }),
        review: makeReview(),
        pull: makePull(),
      });
      mockRepo.getPrFiles = vi.fn().mockResolvedValue([makePrFile('other/file.ts')]);

      await expect(
        buildEvalDraft(mockRepo as ReviewRepository, WORKSPACE_ID, FINDING_ID),
      ).rejects.toThrow(ConflictError);
    });
  });

  it('REQ-3 (extension) — a null review.agent_id answers 409 with its own reason', async () => {
    mockRepo.findingContext = vi.fn().mockResolvedValue({
      finding: makeFinding({ acceptedAt: new Date() }),
      review: makeReview({ agentId: null }),
      pull: makePull(),
    });
    mockRepo.getPrFiles = vi.fn().mockResolvedValue([makePrFile()]);

    const error = await buildEvalDraft(
      mockRepo as ReviewRepository,
      WORKSPACE_ID,
      FINDING_ID,
    ).catch((e) => e);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).statusCode).toBe(409);
    expect((error as ConflictError).message).not.toEqual(
      `No stored diff is available for ${FILE_PATH}`,
    );
  });

  it('REQ-4 — an accepted finding yields a POSITIVE (must_find) case', async () => {
    const finding = makeFinding({ acceptedAt: new Date() });
    mockRepo.findingContext = vi.fn().mockResolvedValue({
      finding,
      review: makeReview({ agentId: AGENT_ID }),
      pull: makePull(),
    });
    mockRepo.getPrFiles = vi.fn().mockResolvedValue([makePrFile()]);

    const draft = await buildEvalDraft(mockRepo as ReviewRepository, WORKSPACE_ID, FINDING_ID);

    expect(draft.owner_kind).toBe('agent');
    expect(draft.owner_id).toBe(AGENT_ID);
    expect(draft.input_diff).toBe(buildAgentCaseDiff(FILE_PATH, PATCH));
    expect(draft.name).toBe(`From finding: ${finding.title}`);
    expect(draft.expected_output).toEqual([
      {
        severity: finding.severity,
        category: finding.category,
        title: finding.title,
        file: finding.file,
        // Padded by EXPECTATION_LINE_PADDING (3) around 10-14: scoring.ts
        // matches on range intersection alone, so an unpadded window turns a
        // one-line citation drift into recall 0 / precision 0.
        start_line: 7,
        end_line: 17,
      },
    ]);
    // A positive case declares no forbidden region — that is the dismissed arm.
    expect(draft.forbidden_regions).toEqual([]);
  });

  it('REQ-4 — the name is truncated to the cap', async () => {
    const longTitle = 'x'.repeat(500);
    const finding = makeFinding({ acceptedAt: new Date(), title: longTitle });
    mockRepo.findingContext = vi.fn().mockResolvedValue({
      finding,
      review: makeReview(),
      pull: makePull(),
    });
    mockRepo.getPrFiles = vi.fn().mockResolvedValue([makePrFile()]);

    const draft = await buildEvalDraft(mockRepo as ReviewRepository, WORKSPACE_ID, FINDING_ID);

    expect(draft.name.length).toBeLessThan(`From finding: ${longTitle}`.length);
    expect(`From finding: ${longTitle}`.startsWith(draft.name)).toBe(true);
  });

  it('REQ-5 — a dismissed finding yields a NEGATIVE (must_not_flag) case: empty expected_output, one forbidden region', async () => {
    const finding = makeFinding({ acceptedAt: null, dismissedAt: new Date() });
    mockRepo.findingContext = vi.fn().mockResolvedValue({
      finding,
      review: makeReview({ agentId: AGENT_ID }),
      pull: makePull(),
    });
    mockRepo.getPrFiles = vi.fn().mockResolvedValue([makePrFile()]);

    const draft = await buildEvalDraft(mockRepo as ReviewRepository, WORKSPACE_ID, FINDING_ID);

    expect(draft.owner_kind).toBe('agent');
    expect(draft.owner_id).toBe(AGENT_ID);
    expect(draft.expected_output).toEqual([]);
    expect(draft.forbidden_regions).toEqual([
      { file: finding.file, start_line: 7, end_line: 17 },
    ]);
  });

  it('the padded window is clamped at line 1 and survives a reversed range', async () => {
    // start_line > end_line reaches this code from stored model output, and
    // a finding on line 1 would otherwise pad to 0 / -2.
    const finding = makeFinding({ acceptedAt: new Date(), startLine: 2, endLine: 1 });
    mockRepo.findingContext = vi.fn().mockResolvedValue({
      finding,
      review: makeReview({ agentId: AGENT_ID }),
      pull: makePull(),
    });
    mockRepo.getPrFiles = vi.fn().mockResolvedValue([makePrFile()]);

    const draft = await buildEvalDraft(mockRepo as ReviewRepository, WORKSPACE_ID, FINDING_ID);

    expect(draft.expected_output[0]).toMatchObject({ start_line: 1, end_line: 5 });
  });

  it('answers 409 when the finding is neither accepted nor dismissed', async () => {
    mockRepo.findingContext = vi.fn().mockResolvedValue({
      finding: makeFinding({ acceptedAt: null, dismissedAt: null }),
      review: makeReview(),
      pull: makePull(),
    });
    mockRepo.getPrFiles = vi.fn().mockResolvedValue([makePrFile()]);

    await expect(
      buildEvalDraft(mockRepo as ReviewRepository, WORKSPACE_ID, FINDING_ID),
    ).rejects.toThrow(ConflictError);
  });

  it('the endpoint writes nothing: no mutating repository method is invoked', async () => {
    // The mock only exposes the two read methods the function is allowed to
    // call. If the implementation tried to persist anything, calling a
    // method not present on `mockRepo` would throw a TypeError here rather
    // than silently succeeding.
    mockRepo.findingContext = vi.fn().mockResolvedValue({
      finding: makeFinding({ acceptedAt: new Date() }),
      review: makeReview(),
      pull: makePull(),
    });
    mockRepo.getPrFiles = vi.fn().mockResolvedValue([makePrFile()]);

    await buildEvalDraft(mockRepo as ReviewRepository, WORKSPACE_ID, FINDING_ID);

    expect(Object.keys(mockRepo)).toEqual(['findingContext', 'getPrFiles']);
  });
});
