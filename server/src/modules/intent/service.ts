/**
 * service.ts — IntentService: orchestrates intent computation for a PR.
 *
 * Onion layer: application layer — orchestrates repo + adapters; no SQL here.
 * - Loads PR + repo via ReviewRepository (no new repo class).
 * - Loads UnifiedDiff via loadDiff (falls back to pr_files reconstruction).
 * - Resolves linked issue + reference set via references.ts.
 * - Resolves feature model via resolveFeatureModel (review_intent slot).
 * - Calls classifyIntent (classifier.ts).
 * - Upserts result via repo.upsertIntent.
 *
 * Security: GitHub/git/webFetch are best-effort; missing PAT/clone/URL skips
 * that enricher, never fails compute. Only a missing PR throws NotFoundError.
 */
import type { Container } from '../../platform/container.js';
import type { Intent, PrIntentRecord, UnifiedDiff } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewRepository } from '../reviews/repository.js';
import type { PullRow } from '../reviews/repository.js';
import * as schema from '../../db/schema.js';
import { loadDiff } from '../reviews/diff-loader.js';
import { parseReferences, resolveReferences } from './references.js';
import { classifyIntent } from './classifier.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import type { Logger } from '../reviews/run-executor.js';

export class IntentService {
  private repo: ReviewRepository;
  private logger: Logger | undefined;

  constructor(private container: Container, logger?: Logger) {
    this.repo = new ReviewRepository(container.db);
    // Optional pino-compatible logger. Route paths pass Fastify's `app.log`;
    // a review run passes its run logger. When present, the reference resolver
    // and classifier emit HOW the prompt was assembled — which specs/plans were
    // resolved, token savings, and the full prompt at debug level — so the
    // computation is verifiable post-hoc instead of inferred from the output.
    // Defaults to undefined so the service degrades gracefully in tests.
    this.logger = logger;
  }

  /**
   * Return stored intent if present (cache-hit: no LLM call).
   * Compute + store on miss.
   */
  async getOrCompute(workspaceId: string, prId: string): Promise<PrIntentRecord> {
    const stored = await this.repo.getIntent(prId);
    if (stored) {
      return { ...stored, pr_id: prId };
    }
    return this.compute(workspaceId, prId);
  }

  /**
   * Always re-computes + upserts, even if a stored intent exists.
   */
  async recompute(workspaceId: string, prId: string): Promise<PrIntentRecord> {
    return this.compute(workspaceId, prId);
  }

  /**
   * Compute intent reusing a pre-loaded UnifiedDiff (for run-executor T6).
   * Does NOT call loadDiff again — avoids double diff-loading in a review run.
   * Returns the raw Intent (not PrIntentRecord) so the caller can thread it
   * into the prompt without caring about the pr_id wrapper.
   *
   * Side effect: upserts the intent in the DB so subsequent getOrCompute calls
   * return it without another LLM call.
   */
  async computeForRun(
    workspaceId: string,
    pull: PullRow,
    repoRow: typeof schema.repos.$inferSelect,
    diff: UnifiedDiff,
  ): Promise<Intent> {
    const record = await this.compute(workspaceId, pull.id, diff);
    const { pr_id: _pr_id, ...intent } = record;
    return intent as Intent;
  }

  // ---- private shared orchestration -----------------------------------------

  private async compute(
    workspaceId: string,
    prId: string,
    preloadedDiff?: UnifiedDiff,
  ): Promise<PrIntentRecord> {
    // 1. Load the PR row (workspace-scoped). Missing → NotFoundError.
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError(`Pull request not found: ${prId}`);

    // 2. Load the repo row.
    const repoRow = await this.repo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError(`Repository not found for PR: ${prId}`);

    // 3. Load the diff (or reuse a pre-loaded one to avoid double loading).
    const diff = preloadedDiff ?? await loadDiff(this.container, this.repo, workspaceId, pull, repoRow);

    // 4. Build the repoRef for git.readFile / GitHub issue resolution.
    const repoRef = { owner: repoRow.owner, name: repoRow.name };

    // 5. Resolve GitHub client — best-effort; missing PAT → null.
    const github = await this.container.github().catch(() => null);

    // 6. Determine if external URL fetching is enabled.
    const webFetch = this.container.config.externalFetchEnabled
      ? this.container.webFetch
      : null;

    // 7. Parse references from the PR body + resolve them best-effort.
    const parsedRefs = parseReferences(pull.body, repoRef);
    const references = await resolveReferences(parsedRefs, {
      repoRef,
      git: this.container.git,
      github,
      webFetch,
      logger: this.logger,
    });

    // Verification signal: surface exactly which references were found in the PR
    // body and which were actually resolved into the classifier input. An empty
    // `resolved` array here means NO spec/plan reached the model — the intent was
    // derived from title + file list + hunk headers alone.
    this.logger?.info(
      {
        prId,
        parsed: {
          total: parsedRefs.length,
          repoFile: parsedRefs.filter((r) => r.kind === 'repo-file').length,
          github: parsedRefs.filter((r) => r.kind === 'github').length,
          url: parsedRefs.filter((r) => r.kind === 'url').length,
        },
        resolved: references.map((r) => ({ kind: r.kind, source: r.source })),
      },
      `intent: parsed ${parsedRefs.length} reference(s) from PR body, resolved ${references.length}`,
    );

    // 8. Extract the first linked issue as a dedicated `issue` parameter for
    //    the classifier. The resolved references already contain GitHub issues,
    //    but passing the first one separately sharpens the "Linked Issue" section
    //    in the prompt. Best-effort: use the first github ref content if available.
    let issue: { title: string; body: string | null } | null = null;
    if (github) {
      const firstGithubRef = parsedRefs.find((r) => r.kind === 'github');
      if (firstGithubRef?.issueNumber != null) {
        const n = firstGithubRef.issueNumber;
        const targetRef =
          firstGithubRef.targetOwner && firstGithubRef.targetRepo
            ? { owner: firstGithubRef.targetOwner, name: firstGithubRef.targetRepo }
            : repoRef;
        try {
          const fetched = await github.getIssue(targetRef, n);
          issue = { title: fetched.title, body: fetched.body ?? null };
        } catch {
          // Fall back to getPullRequest on 404.
          try {
            const pr = await github.getPullRequest(targetRef, n);
            issue = { title: pr.title, body: pr.body ?? null };
          } catch {
            // Best-effort: skip the linked issue if both fetches fail.
          }
        }
      }
    }

    // 9. Resolve the feature model for the review_intent slot.
    const { provider, model } = await resolveFeatureModel(
      this.container,
      workspaceId,
      'review_intent',
    );
    const llm = await this.container.llm(provider);

    // 10. Call the intent classifier.
    const { intent } = await classifyIntent({
      title: pull.title,
      body: pull.body,
      issue,
      references,
      diff,
      llm,
      model,
      logger: this.logger,
    });

    // 11. Persist + return.
    await this.repo.upsertIntent(prId, intent);
    return { ...intent, pr_id: prId };
  }
}
