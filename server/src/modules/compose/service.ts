import type { Container } from '../../platform/container.js';
import type { Verdict } from '@devdigest/shared';
import type {
  ComposedReview,
  ComposeReviewInput,
  ComposeReviewPreview,
} from '@devdigest/shared/contracts/eval-ci';
import { eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewRepository, type FindingRow } from '../reviews/repository.js';
import { SEV_EMOJI, VERDICT_EVENT } from './constants.js';
import { severityCounts } from './helpers.js';

/**
 * A4 — Compose Review (§7 L06). Turn selected findings into an editable markdown
 * review body (+ optional inline comments), then POST it to GitHub as the user
 * (PAT) via the Octokit GitHubClient (`container.github().postReview`). The
 * posted review id is persisted in `composed_reviews.github_review_id`.
 *
 * Posting is mockable: tests inject MockGitHubClient and assert `posted`.
 */

export class ComposeService {
  private reviews: ReviewRepository;

  constructor(private container: Container) {
    this.reviews = new ReviewRepository(container.db);
  }

  /** Compose a draft (no GitHub side-effect) — used to seed the editor. */
  async preview(
    workspaceId: string,
    prId: string,
    input: ComposeReviewInput,
  ): Promise<ComposeReviewPreview> {
    const { findings } = await this.load(workspaceId, prId, input.finding_ids);
    const body = input.body?.trim() ? input.body : this.composeBody(findings, input.verdict);
    const inline = input.inline_comments ? this.inlineComments(findings) : [];
    return { body, verdict: input.verdict, inline_comments: inline };
  }

  /** Compose + POST to GitHub + persist `composed_reviews`. */
  async post(
    workspaceId: string,
    prId: string,
    input: ComposeReviewInput,
  ): Promise<ComposedReview> {
    const { pull, repo, findings } = await this.load(workspaceId, prId, input.finding_ids);
    const body = input.body?.trim() ? input.body : this.composeBody(findings, input.verdict);
    const inline = input.inline_comments ? this.inlineComments(findings) : [];

    const github = await this.container.github();
    const res = await github.postReview(
      { owner: repo.owner, name: repo.name },
      pull.number,
      {
        body,
        event: VERDICT_EVENT[input.verdict],
        ...(inline.length ? { comments: inline } : {}),
      },
    );

    const [row] = await this.container.db
      .insert(t.composedReviews)
      .values({
        prId: pull.id,
        body,
        verdict: input.verdict,
        postedAt: new Date(),
        githubReviewId: res.id,
      })
      .returning();

    return this.toDto(row!);
  }

  async listForPull(workspaceId: string, prId: string): Promise<ComposedReview[]> {
    const pull = await this.reviews.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const rows = await this.container.db
      .select()
      .from(t.composedReviews)
      .where(eq(t.composedReviews.prId, prId));
    return rows.map((r) => this.toDto(r));
  }

  // ---- helpers ------------------------------------------------------------

  private async load(workspaceId: string, prId: string, findingIds: string[]) {
    const pull = await this.reviews.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.reviews.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    let findings: FindingRow[] = [];
    if (findingIds.length > 0) {
      const resolved = await Promise.all(findingIds.map((id) => this.reviews.getFinding(id)));
      findings = resolved.filter((f): f is FindingRow => Boolean(f));
    } else {
      // default: all findings on the PR's latest reviews
      const reviews = await this.reviews.reviewsForPull(prId);
      findings = reviews.flatMap((r) => r.findings);
    }
    return { pull, repo, findings };
  }

  private composeBody(findings: FindingRow[], verdict: Verdict): string {
    const header =
      verdict === 'approve'
        ? '## DevDigest Review — Approved ✅'
        : verdict === 'request_changes'
          ? '## DevDigest Review — Changes requested'
          : '## DevDigest Review';

    if (findings.length === 0) {
      return `${header}\n\n_No findings selected. Looks good._`;
    }

    const lines = findings.map((f) => {
      const emoji = SEV_EMOJI[f.severity] ?? '•';
      const loc = `\`${f.file}:${f.startLine}${f.endLine !== f.startLine ? `-${f.endLine}` : ''}\``;
      const sugg = f.suggestion ? `\n  - _Suggestion:_ ${f.suggestion}` : '';
      return `- ${emoji} **${f.title}** (${f.severity.toLowerCase()}, ${f.category}) — ${loc}\n  - ${f.rationale}${sugg}`;
    });

    const counts = severityCounts(findings);
    const summary = `**${findings.length} finding${findings.length === 1 ? '' : 's'}** · ${counts}`;
    return `${header}\n\n${summary}\n\n${lines.join('\n')}\n\n_Posted via DevDigest._`;
  }

  private inlineComments(findings: FindingRow[]): { path: string; line: number; body: string }[] {
    return findings.map((f) => ({
      path: f.file,
      line: f.endLine,
      body: `**${f.title}** (${f.severity.toLowerCase()})\n\n${f.rationale}${
        f.suggestion ? `\n\n_Suggestion:_ ${f.suggestion}` : ''
      }`,
    }));
  }

  private toDto(row: typeof t.composedReviews.$inferSelect): ComposedReview {
    return {
      id: row.id,
      pr_id: row.prId,
      body: row.body,
      verdict: (row.verdict as Verdict | null) ?? null,
      posted_at: row.postedAt?.toISOString() ?? null,
      github_review_id: row.githubReviewId,
    };
  }
}
