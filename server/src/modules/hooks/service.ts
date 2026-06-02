import type { Container } from '../../platform/container.js';
import type { Finding, UnifiedDiff } from '@devdigest/shared';
import type { HookScanResult } from '@devdigest/shared/contracts/eval-ci';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { groundFindings } from '../../platform/grounding.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewRepository, type PullRow } from '../reviews/repository.js';
import { runHookDetectors } from './detectors.js';
import { summarizeKinds } from './helpers.js';

/**
 * A4 — Hooks (Secret-Leakage + Phantom-API). Runs the deterministic detectors
 * over a PR's diff and persists the emitted findings as a review row
 * (agentId=null, model='detectors'), reusing A2's ReviewRepository WITHOUT
 * touching A2's reviewer service. The findings carry full-file kinds
 * (`secret_leak`/`phantom`) which are grounding-EXEMPT (ARCHITECTURE.md §8):
 * groundFindings keeps them as long as the file is present in the diff.
 */
export class HooksService {
  private reviews: ReviewRepository;

  constructor(private container: Container) {
    this.reviews = new ReviewRepository(container.db);
  }

  async scan(
    workspaceId: string,
    prId: string,
    which: { secret?: boolean; phantom?: boolean } = {},
  ): Promise<HookScanResult> {
    const pull = await this.reviews.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.reviews.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const diff = await this.loadDiff(pull, repo);
    const raw = runHookDetectors(diff, which);

    // Honor the citation gate (full-file kinds pass when the file is in the diff).
    const { kept } = groundFindings(raw, diff);

    if (kept.length === 0) {
      return { pr_id: prId, review_id: null, findings: [] };
    }

    const review = await this.reviews.insertReview({
      workspaceId,
      prId: pull.id,
      agentId: null,
      kind: 'review',
      verdict: kept.some((f) => f.severity === 'CRITICAL') ? 'request_changes' : 'comment',
      summary: `Hook detectors found ${kept.length} issue(s): ${summarizeKinds(kept)}.`,
      score: null,
      model: 'detectors',
    });
    const rows = await this.reviews.insertFindings(review.id, kept);

    return {
      pr_id: prId,
      review_id: review.id,
      findings: rows.map((r) => ({
        id: r.id,
        severity: r.severity as Finding['severity'],
        category: r.category as Finding['category'],
        title: r.title,
        file: r.file,
        start_line: r.startLine,
        end_line: r.endLine,
        rationale: r.rationale,
        suggestion: r.suggestion ?? null,
        confidence: r.confidence,
        kind: (r.kind as Finding['kind']) ?? 'finding',
        trifecta_components: null,
        evidence: null,
      })),
    };
  }

  private async loadDiff(
    pull: PullRow,
    repo: typeof import('../../db/schema.js').repos.$inferSelect,
  ): Promise<UnifiedDiff> {
    try {
      const diff = await this.container.git.diff(
        { owner: repo.owner, name: repo.name },
        pull.base,
        pull.headSha,
      );
      if (diff.files.length > 0) return diff;
    } catch {
      /* fall through */
    }
    const files = await this.reviews.getPrFiles(pull.id);
    const parts: string[] = [];
    for (const f of files) {
      if (!f.patch) continue;
      parts.push(`diff --git a/${f.path} b/${f.path}`);
      parts.push(`--- a/${f.path}`);
      parts.push(`+++ b/${f.path}`);
      parts.push(f.patch);
    }
    return parseUnifiedDiff(parts.join('\n'));
  }
}
