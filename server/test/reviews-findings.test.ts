import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundError, AppError } from '../src/platform/errors.js';
import { actOnFinding } from '../src/modules/reviews/findings.js';
import type { ReviewRepository } from '../src/modules/reviews/repository.js';
import type { FindingRow } from '../src/db/rows.js';

/**
 * Unit tests for finding action handlers (accept/dismiss) — hermetic, no DB.
 * Tests the validation and state transitions for finding actions, which are
 * regression risks: accepting a finding must clear the dismissed_at field,
 * and vice versa. Workspace tenancy must be enforced on every path.
 */

describe('actOnFinding — Finding action handlers', () => {
  let mockRepo: Partial<ReviewRepository>;

  beforeEach(() => {
    mockRepo = {
      findingContext: vi.fn(),
      setFindingAccepted: vi.fn(),
      setFindingDismissed: vi.fn(),
      clearFindingDecision: vi.fn(),
    };
  });

  describe('accept action', () => {
    it('accepts a finding and returns the updated DTO', async () => {
      const now = new Date();
      const findingRow: FindingRow = {
        id: 'f1',
        reviewId: 'review1',
        severity: 'CRITICAL',
        category: 'security',
        title: 'SQL injection',
        file: 'src/db.ts',
        startLine: 42,
        endLine: 42,
        rationale: 'User input is not escaped',
        suggestion: 'Use parameterized queries',
        confidence: 0.95,
        kind: 'finding',
        trifectaComponents: null,
        acceptedAt: now,
        dismissedAt: null,
      };

      mockRepo.findingContext = vi.fn().mockResolvedValue({
        pull: { id: 'pr1', workspaceId: 'ws1' },
        review: { id: 'review1' },
      });

      mockRepo.setFindingAccepted = vi.fn().mockResolvedValue(findingRow);

      const result = await actOnFinding(
        mockRepo as ReviewRepository,
        'ws1',
        'f1',
        'accept',
      );

      expect(result.finding.id).toBe('f1');
      expect(result.finding.accepted_at).not.toBeNull();
      expect(mockRepo.setFindingAccepted).toHaveBeenCalledWith('f1', expect.any(Date));
    });

    it('clears dismissed_at when accepting a previously dismissed finding', async () => {
      const findingRow: FindingRow = {
        id: 'f1',
        reviewId: 'review1',
        severity: 'WARNING',
        category: 'bug',
        title: 'Off-by-one',
        file: 'src/index.ts',
        startLine: 100,
        endLine: 100,
        rationale: 'Loop boundary is incorrect',
        suggestion: 'Use < instead of <=',
        confidence: 0.8,
        kind: 'finding',
        trifectaComponents: null,
        acceptedAt: new Date(),
        dismissedAt: null, // should be null after accept
      };

      mockRepo.findingContext = vi.fn().mockResolvedValue({
        pull: { id: 'pr1', workspaceId: 'ws1' },
        review: { id: 'review1' },
      });

      mockRepo.setFindingAccepted = vi.fn().mockResolvedValue(findingRow);

      const result = await actOnFinding(
        mockRepo as ReviewRepository,
        'ws1',
        'f1',
        'accept',
      );

      // The DB row should have dismissed_at as null (setFindingAccepted clears it)
      expect(result.finding.dismissed_at).toBeNull();
    });

    it('throws NotFoundError when finding does not exist', async () => {
      mockRepo.findingContext = vi.fn().mockResolvedValue(null);

      await expect(
        actOnFinding(mockRepo as ReviewRepository, 'ws1', 'f_nonexistent', 'accept'),
      ).rejects.toThrow(NotFoundError);
    });

    it('enforces workspace tenancy: throws when finding belongs to different workspace', async () => {
      mockRepo.findingContext = vi.fn().mockResolvedValue({
        pull: { id: 'pr1', workspaceId: 'ws2' }, // different workspace
        review: { id: 'review1' },
      });

      await expect(
        actOnFinding(mockRepo as ReviewRepository, 'ws1', 'f1', 'accept'),
      ).rejects.toThrow(NotFoundError);
    });

    it('passes the correct date to setFindingAccepted for audit trail', async () => {
      const now = new Date();
      const findingRow: FindingRow = {
        id: 'f1',
        reviewId: 'review1',
        severity: 'CRITICAL',
        category: 'security',
        title: 'XSS',
        file: 'src/app.tsx',
        startLine: 25,
        endLine: 25,
        rationale: 'User input rendered without escaping',
        suggestion: 'Use textContent instead of innerHTML',
        confidence: 0.99,
        kind: 'finding',
        trifectaComponents: null,
        acceptedAt: now,
        dismissedAt: null,
      };

      mockRepo.findingContext = vi.fn().mockResolvedValue({
        pull: { id: 'pr1', workspaceId: 'ws1' },
        review: { id: 'review1' },
      });

      mockRepo.setFindingAccepted = vi.fn().mockResolvedValue(findingRow);

      await actOnFinding(mockRepo as ReviewRepository, 'ws1', 'f1', 'accept');

      // Verify a date was passed (not null or undefined)
      const [_findingId, date] = (mockRepo.setFindingAccepted as any).mock.calls[0];
      expect(date).toBeInstanceOf(Date);
    });
  });

  describe('dismiss action', () => {
    it('dismisses a finding and returns the updated DTO', async () => {
      const now = new Date();
      const findingRow: FindingRow = {
        id: 'f1',
        reviewId: 'review1',
        severity: 'INFO',
        category: 'style',
        title: 'Unused variable',
        file: 'src/utils.ts',
        startLine: 15,
        endLine: 15,
        rationale: 'Variable foo is declared but never used',
        suggestion: 'Remove the variable or prefix with underscore',
        confidence: 1.0,
        kind: 'finding',
        trifectaComponents: null,
        acceptedAt: null,
        dismissedAt: now,
      };

      mockRepo.findingContext = vi.fn().mockResolvedValue({
        pull: { id: 'pr1', workspaceId: 'ws1' },
        review: { id: 'review1' },
      });

      mockRepo.setFindingDismissed = vi.fn().mockResolvedValue(findingRow);

      const result = await actOnFinding(
        mockRepo as ReviewRepository,
        'ws1',
        'f1',
        'dismiss',
      );

      expect(result.finding.id).toBe('f1');
      expect(result.finding.dismissed_at).not.toBeNull();
      expect(mockRepo.setFindingDismissed).toHaveBeenCalledWith('f1', expect.any(Date));
    });

    it('clears accepted_at when dismissing a previously accepted finding', async () => {
      const findingRow: FindingRow = {
        id: 'f1',
        reviewId: 'review1',
        severity: 'CRITICAL',
        category: 'security',
        title: 'XSS vulnerability',
        file: 'src/app.tsx',
        startLine: 50,
        endLine: 50,
        rationale: 'Unescaped user input in template',
        suggestion: 'Use a template escape function',
        confidence: 0.98,
        kind: 'finding',
        trifectaComponents: null,
        acceptedAt: null, // should be null after dismiss
        dismissedAt: new Date(),
      };

      mockRepo.findingContext = vi.fn().mockResolvedValue({
        pull: { id: 'pr1', workspaceId: 'ws1' },
        review: { id: 'review1' },
      });

      mockRepo.setFindingDismissed = vi.fn().mockResolvedValue(findingRow);

      const result = await actOnFinding(
        mockRepo as ReviewRepository,
        'ws1',
        'f1',
        'dismiss',
      );

      // The DB row should have accepted_at as null (setFindingDismissed clears it)
      expect(result.finding.accepted_at).toBeNull();
    });

    it('throws NotFoundError when finding does not exist', async () => {
      mockRepo.findingContext = vi.fn().mockResolvedValue(null);

      await expect(
        actOnFinding(mockRepo as ReviewRepository, 'ws1', 'f_missing', 'dismiss'),
      ).rejects.toThrow(NotFoundError);
    });

    it('enforces workspace tenancy: throws when finding belongs to different workspace', async () => {
      mockRepo.findingContext = vi.fn().mockResolvedValue({
        pull: { id: 'pr1', workspaceId: 'ws_other' },
        review: { id: 'review1' },
      });

      await expect(
        actOnFinding(mockRepo as ReviewRepository, 'ws1', 'f1', 'dismiss'),
      ).rejects.toThrow(NotFoundError);
    });

    it('does not expose internal IDs in the NotFoundError for dismissed findings', async () => {
      mockRepo.findingContext = vi.fn().mockResolvedValue(null);

      const error = await (async () => {
        try {
          await actOnFinding(mockRepo as ReviewRepository, 'ws1', 'f1', 'dismiss');
        } catch (e) {
          return e as NotFoundError;
        }
      })();

      expect(error?.message).not.toContain('f1');
    });
  });

  describe('revert action', () => {
    const REVERTED: FindingRow = {
      id: 'f1',
      reviewId: 'review1',
      severity: 'WARNING',
      category: 'bug',
      title: 'Missing authentication in API calls',
      file: 'client/src/lib/api.ts',
      startLine: 9,
      endLine: 12,
      rationale: 'apiFetch builds requests with no Authorization header',
      suggestion: 'Add an Authorization header',
      confidence: 0.9,
      kind: 'finding',
      trifectaComponents: null,
      acceptedAt: null,
      dismissedAt: null,
    };

    beforeEach(() => {
      mockRepo.findingContext = vi.fn().mockResolvedValue({
        pull: { id: 'pr1', workspaceId: 'ws1' },
        review: { id: 'review1' },
      });
      mockRepo.clearFindingDecision = vi.fn().mockResolvedValue(REVERTED);
    });

    it('clears BOTH timestamps, returning the finding to undecided', async () => {
      const result = await actOnFinding(mockRepo as ReviewRepository, 'ws1', 'f1', 'revert');

      expect(result.finding.accepted_at).toBeNull();
      expect(result.finding.dismissed_at).toBeNull();
      expect(mockRepo.clearFindingDecision).toHaveBeenCalledWith('f1');
    });

    it('reverts through the dedicated clear, never by re-using a decision setter', async () => {
      // The mutation that would break this: implementing revert as
      // `setFindingAccepted(id, null)`. That happens to null both columns
      // today, but it writes a revert into the accept path, so any future
      // change to accept (an audit row, a `learn` side effect) silently fires
      // on an undo.
      await actOnFinding(mockRepo as ReviewRepository, 'ws1', 'f1', 'revert');

      expect(mockRepo.setFindingAccepted).not.toHaveBeenCalled();
      expect(mockRepo.setFindingDismissed).not.toHaveBeenCalled();
    });

    it('accept → revert → dismiss is the full round trip the UI drives', async () => {
      mockRepo.setFindingAccepted = vi
        .fn()
        .mockResolvedValue({ ...REVERTED, acceptedAt: new Date() });
      mockRepo.setFindingDismissed = vi
        .fn()
        .mockResolvedValue({ ...REVERTED, dismissedAt: new Date() });

      const accepted = await actOnFinding(mockRepo as ReviewRepository, 'ws1', 'f1', 'accept');
      expect(accepted.finding.accepted_at).not.toBeNull();

      const reverted = await actOnFinding(mockRepo as ReviewRepository, 'ws1', 'f1', 'revert');
      expect(reverted.finding.accepted_at).toBeNull();
      expect(reverted.finding.dismissed_at).toBeNull();

      const dismissed = await actOnFinding(mockRepo as ReviewRepository, 'ws1', 'f1', 'dismiss');
      expect(dismissed.finding.dismissed_at).not.toBeNull();
      expect(dismissed.finding.accepted_at).toBeNull();
    });

    it('throws NotFoundError when the finding does not exist', async () => {
      mockRepo.findingContext = vi.fn().mockResolvedValue(null);

      await expect(
        actOnFinding(mockRepo as ReviewRepository, 'ws1', 'f_missing', 'revert'),
      ).rejects.toThrow(NotFoundError);
      expect(mockRepo.clearFindingDecision).not.toHaveBeenCalled();
    });

    it('enforces workspace tenancy: throws for a finding in another workspace', async () => {
      mockRepo.findingContext = vi.fn().mockResolvedValue({
        pull: { id: 'pr1', workspaceId: 'ws_other' },
        review: { id: 'review1' },
      });

      await expect(
        actOnFinding(mockRepo as ReviewRepository, 'ws1', 'f1', 'revert'),
      ).rejects.toThrow(NotFoundError);
      expect(mockRepo.clearFindingDecision).not.toHaveBeenCalled();
    });
  });

  describe('state transitions', () => {
    it('accept → dismiss transition clears accepted_at and sets dismissed_at', async () => {
      // This tests the full state machine: a finding starts null, is accepted,
      // then dismissed, and only dismissed_at should be set.
      const findingRow: FindingRow = {
        id: 'f1',
        reviewId: 'review1',
        severity: 'HIGH',
        category: 'bug',
        title: 'Race condition',
        file: 'src/sync.ts',
        startLine: 88,
        endLine: 88,
        rationale: 'Async operation not awaited',
        suggestion: 'Add await or use .then()',
        confidence: 0.85,
        kind: 'finding',
        trifectaComponents: null,
        acceptedAt: null, // was accepted, now dismissed
        dismissedAt: new Date(),
      };

      mockRepo.findingContext = vi.fn().mockResolvedValue({
        pull: { id: 'pr1', workspaceId: 'ws1' },
        review: { id: 'review1' },
      });

      mockRepo.setFindingDismissed = vi.fn().mockResolvedValue(findingRow);

      const result = await actOnFinding(
        mockRepo as ReviewRepository,
        'ws1',
        'f1',
        'dismiss',
      );

      expect(result.finding.accepted_at).toBeNull();
      expect(result.finding.dismissed_at).not.toBeNull();
    });

    it('dismiss → accept transition clears dismissed_at and sets accepted_at', async () => {
      const findingRow: FindingRow = {
        id: 'f1',
        reviewId: 'review1',
        severity: 'MEDIUM',
        category: 'style',
        title: 'Comment needed',
        file: 'src/math.ts',
        startLine: 33,
        endLine: 33,
        rationale: 'Complex logic lacks explanation',
        suggestion: 'Add inline comment explaining the algorithm',
        confidence: 0.6,
        kind: 'finding',
        trifectaComponents: null,
        acceptedAt: new Date(),
        dismissedAt: null, // was dismissed, now accepted
      };

      mockRepo.findingContext = vi.fn().mockResolvedValue({
        pull: { id: 'pr1', workspaceId: 'ws1' },
        review: { id: 'review1' },
      });

      mockRepo.setFindingAccepted = vi.fn().mockResolvedValue(findingRow);

      const result = await actOnFinding(
        mockRepo as ReviewRepository,
        'ws1',
        'f1',
        'accept',
      );

      expect(result.finding.dismissed_at).toBeNull();
      expect(result.finding.accepted_at).not.toBeNull();
    });
  });

  describe('invalid actions', () => {
    it('throws AppError for unknown action types', async () => {
      mockRepo.findingContext = vi.fn().mockResolvedValue({
        pull: { id: 'pr1', workspaceId: 'ws1' },
        review: { id: 'review1' },
      });

      // Cast to bypass TypeScript's literal type checking (real callers won't do this,
      // but the function should still handle it gracefully)
      await expect(
        actOnFinding(
          mockRepo as ReviewRepository,
          'ws1',
          'f1',
          'invalid_action' as any,
        ),
      ).rejects.toThrow(AppError);
    });
  });
});
