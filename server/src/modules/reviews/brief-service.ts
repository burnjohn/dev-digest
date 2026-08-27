/**
 * PR Risk Brief — the orchestrating service (server/specs/SPEC-02-pr-risk-brief.md, T6).
 *
 * A SEPARATE service from `ReviewService`, not a new method on it — `ReviewService` still takes
 * the whole `Container` (the known V1 onion violation), and adding a brief method there would
 * drag this new code into it. `BriefServiceDeps` is explicit (onion-architecture §3): `llm` and
 * `github` stay LAZY resolvers (never a resolved client), matching `Container.llm(id)` /
 * `Container.github()` exactly, so booting with no keys configured still works.
 *
 * Order of operations — REQ-5's whole content: resolve tenancy FIRST (`getPull` → 404 on miss),
 * THEN consult the cache. A hit with `force` not `true` returns immediately: zero model
 * resolution, zero GitHub call, zero blast computation, zero read of the PR's latest commit
 * (REQ-2, REQ-4, REQ-22 — `pr_brief` carries no such column at all, see
 * `repository/brief.repo.ts`). A miss
 * (or `force: true`) gathers sources (T3's `gatherBriefSources`), resolves the feature model
 * through the per-call resolver, makes the one model call (T3's `generateBrief`),
 * grounds/dedupes/caps (T4's `groundBrief`), logs once (REQ-23/REQ-25), and upserts.
 *
 * Deliberately NOT reproduced: `getOrClassifyIntent`'s `isStaleFallback` retry window
 * (service.ts:305-308, `INTENT_RETRY_WINDOW_MS`) — REQ-38 rejects that shape by name. A brief
 * has no honest deterministic fallback the way a REQ-7 intent classification does: every write
 * here carries a real `model`, or the request fails with no row written at all.
 */
import type {
  BlastProvider,
  BlastRadiusResponse,
  FeatureModelChoice,
  GitClient,
  GitHubClient,
  LLMProvider,
  PrIntentDetail,
  RepoRef,
  RiskBriefResponse,
} from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import { ExternalServiceError, NotFoundError } from '../../platform/errors.js';
import { ReviewRepository } from './repository.js';
import type { StoredIntent } from './repository/pull.repo.js';
import type { IntentLogger } from './intent-classifier.js';
import { gatherBriefSources, type BriefPrFile } from './brief-sources.js';
import { generateBrief } from './brief-generator.js';
import { groundBrief } from './brief-grounding.js';

export interface BriefServiceDeps {
  db: Db;
  git: GitClient;
  /** Lazy resolver — mirrors `Container.github()`; never a resolved client. */
  github: () => Promise<GitHubClient>;
  /** Lazy resolver — mirrors `Container.llm(id)`; never a resolved client. */
  llm: (id: 'openai' | 'anthropic' | 'openrouter') => Promise<LLMProvider>;
  /**
   * T2's cross-module port (`vendor/shared/ports.ts`). `gatherBriefSources`
   * (T3) deliberately does NOT import `BlastProvider` — it takes blast as a
   * plain `() => Promise<BlastRadiusResponse>` thunk, so THIS service is what
   * adapts `container.blast` to that shape (see `fetchBlast` below).
   */
  blast: BlastProvider;
}

export interface GetOrGenerateBriefOptions {
  force?: boolean;
  /**
   * Lazy — called ONLY on a cache miss, so a hit never pays for a settings
   * read (REQ-2, REQ-22). This is a NEW shape for this codebase, not a copy
   * of an existing precedent: `blast/routes.ts:50-51` and
   * `conventions/routes.ts:62` both resolve the feature model EAGERLY,
   * before the service call. `routes.ts` keeps their PLACEMENT rule (the
   * route is the resolution SITE) but deliberately changes the TIMING,
   * because REQ-2 forbids the read on a cache hit — see the comment at the
   * route registration for the same note, so a future reader who greps
   * either eager precedent does not conclude this closure is a mistake.
   */
  resolveModel: () => Promise<FeatureModelChoice>;
  log?: IntentLogger;
}

/**
 * Adapts `BriefServiceDeps.blast` (T2's `BlastProvider` port) into the outcome
 * `gatherBriefSources`'s plain thunk needs — fetched EXACTLY ONCE so both prompt assembly and
 * grounding share one call (never two `getBlastRadius` round-trips per request).
 * `BlastProvider.getBlastRadius` resolving `undefined` (its own "PR not found" case — see
 * `vendor/shared/ports.ts`) is treated the same as a throw: this service already validated
 * tenancy via its own `getPull` above, so an `undefined` here only happens via
 * `MockBlastProvider`'s "no fixture configured" default in tests, which is exactly the
 * "blast unavailable" case REQ-17 describes.
 */
async function fetchBlast(
  blast: BlastProvider,
  workspaceId: string,
  prId: string,
): Promise<{ data?: BlastRadiusResponse; error?: unknown }> {
  try {
    const data = await blast.getBlastRadius(workspaceId, prId);
    if (data === undefined) return { error: new Error('blast: no data for this PR') };
    return { data };
  } catch (err) {
    return { error: err };
  }
}

/** Mirrors `ReviewService.toPrIntentDetail` (service.ts) — a local copy rather than an import
 *  because that conversion is `private` on the class. `StoredIntent.generatedAt` is a `Date`;
 *  the wire's `PrIntentDetail.generated_at` wants an ISO string. */
function toPrIntentDetail(prId: string, stored: StoredIntent): PrIntentDetail {
  return {
    pr_id: prId,
    intent: stored.intent,
    in_scope: stored.in_scope,
    out_of_scope: stored.out_of_scope,
    confidence: stored.confidence,
    sources: stored.sources,
    model: stored.model,
    generated_at: stored.generatedAt.toISOString(),
  };
}

export class BriefService {
  private repo: ReviewRepository;

  constructor(private deps: BriefServiceDeps) {
    this.repo = new ReviewRepository(deps.db);
  }

  async getOrGenerateBrief(
    workspaceId: string,
    prId: string,
    opts: GetOrGenerateBriefOptions,
  ): Promise<RiskBriefResponse> {
    // ---- 1. Tenancy FIRST (REQ-5) --------------------------------------
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    // ---- 2. THEN the cache. A hit does nothing else (REQ-2, REQ-4). ----
    if (opts.force !== true) {
      const existing = await this.repo.getBrief(prId);
      if (existing) return existing;
    }

    // ---- Miss (or force:true) — gather, generate, ground, persist. -----
    const repoRow = await this.repo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');
    const repoRef: RepoRef = { owner: repoRow.owner, name: repoRow.name };

    const [prFiles, storedIntent, model, blastOutcome] = await Promise.all([
      this.repo.filesForPull(prId),
      this.repo.getIntent(prId),
      opts.resolveModel(),
      fetchBlast(this.deps.blast, workspaceId, prId),
    ]);

    if (blastOutcome.error) {
      // REQ-17/REQ-39 degradation — logged, never swallowed
      // (server/INSIGHTS.md, 2026-08-17).
      opts.log?.error(`brief: blast unavailable — ${(blastOutcome.error as Error).message}`);
    }

    const briefPrFiles: BriefPrFile[] = prFiles;
    const intent = storedIntent ? toPrIntentDetail(prId, storedIntent) : null;

    const gathered = await gatherBriefSources(
      { git: this.deps.git, github: this.deps.github },
      {
        repoRef,
        pull: { title: pull.title, body: pull.body },
        prFiles: briefPrFiles,
        intent,
        blast: async () => {
          if (blastOutcome.error) throw blastOutcome.error;
          return blastOutcome.data!;
        },
      },
    );

    if (gathered.sources.linked_issue === 'unavailable') {
      // REQ-39 degradation — logged, never swallowed.
      opts.log?.error('brief: linked issue unavailable');
    }

    // ---- One model call (REQ-46) — a failure here writes NO row and maps
    // to 502 at the route's error handler (platform/errors.ts,
    // ExternalServiceError). ----
    let generated;
    try {
      generated = await generateBrief(
        { llm: this.deps.llm },
        { model, promptSections: gathered.promptSections },
      );
    } catch (err) {
      throw new ExternalServiceError(`risk brief generation failed: ${(err as Error).message}`);
    }

    const prFilePaths = briefPrFiles.map((f) => f.path);
    const { brief: groundedGeneration, counts } = groundBrief(
      generated.generation,
      prFilePaths,
      blastOutcome.data,
    );

    const response: RiskBriefResponse = {
      ...groundedGeneration,
      pr_id: prId,
      sources: gathered.sources,
      model: model.model,
      generated_at: new Date().toISOString(),
    };

    // REQ-23/REQ-25 — one log line per COMPLETED generation. None of these
    // figures reaches the persisted row (`RiskBriefResponse` has no field
    // for any of them — REQ-46). Char counts are read directly off
    // `gathered.charCounts`, populated by `gatherBriefSources` at the same
    // points each source's status is decided — never approximated by
    // measuring the assembled prompt sections, which a `missing` / `skipped`
    // / `unavailable` source never contributes one to.
    opts.log?.info('brief: generation complete', {
      provider: model.provider,
      model: model.model,
      tokensIn: generated.tokensIn,
      tokensOut: generated.tokensOut,
      costUsd: generated.costUsd,
      sources: gathered.sources,
      charCounts: gathered.charCounts,
      grounding: counts,
    });

    await this.repo.upsertBrief(prId, response);

    return response;
  }
}
